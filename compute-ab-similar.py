#!/usr/bin/env python3
"""
Pre-compute artist similarity from artist_clusters using cosine similarity.
Reads from local acousticbrainz PostgreSQL, outputs CSV for COPY import.

Usage:
    ~/miniconda3/envs/musiclynx-similarity/bin/python compute-ab-similar.py
    ~/miniconda3/envs/musiclynx-similarity/bin/python compute-ab-similar.py --features spectral_rhythm
    ~/miniconda3/envs/musiclynx-similarity/bin/python compute-ab-similar.py --features rhythm tonal
"""

import argparse
import csv
import numpy as np
import psycopg2
from scipy.sparse import csr_matrix
from sklearn.metrics.pairwise import cosine_similarity

DB_CONFIG = {
    'dbname': 'acousticbrainz',
    'user': 'alo',
    'host': '/var/run/postgresql',
}

# Map new clustering feature sets to old server category names
FEATURE_MAP = {
    'rhythm': 'rhythm',
    'tonal': 'tonality',
    'spectral': 'timbre',
    'spectral_rhythm': 'timbre_and_rhythm',
}

TOP_N = 15
BATCH_SIZE = 2000
DEFAULT_OUTPUT = 'sql/07-ab-similar.csv'


def get_artist_names(conn):
    """Load artist MBID -> name mapping."""
    cur = conn.cursor()
    cur.execute("SELECT mbid, name FROM artists")
    names = {str(row[0]): row[1] for row in cur.fetchall()}
    cur.close()
    print(f"Loaded {len(names)} artist names")
    return names


def compute_similarity_for_feature(conn, feature_set, output_name, artist_names):
    """Compute top-N similar artists for a feature set."""
    print(f"\n--- {feature_set} -> {output_name} ---")

    cur = conn.cursor()
    cur.execute(
        "SELECT artist_mbid, cluster_id, weight "
        "FROM artist_clusters WHERE feature_set = %s",
        (feature_set,)
    )
    rows = cur.fetchall()
    cur.close()
    print(f"Loaded {len(rows)} cluster assignments")

    if not rows:
        return []

    # Build sparse matrix
    artist_mbids_set = sorted(set(str(r[0]) for r in rows))
    artist_idx = {mbid: i for i, mbid in enumerate(artist_mbids_set)}
    cluster_ids = sorted(set(r[1] for r in rows))
    cluster_idx = {cid: i for i, cid in enumerate(cluster_ids)}

    n_artists = len(artist_mbids_set)
    n_clusters = len(cluster_ids)
    print(f"Matrix: {n_artists} artists x {n_clusters} clusters")

    row_indices = []
    col_indices = []
    data = []
    for r in rows:
        row_indices.append(artist_idx[str(r[0])])
        col_indices.append(cluster_idx[r[1]])
        data.append(r[2])

    matrix = csr_matrix(
        (data, (row_indices, col_indices)),
        shape=(n_artists, n_clusters),
        dtype=np.float32
    )

    # Compute similarity in batches
    results = []
    n_batches = (n_artists + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_idx in range(n_batches):
        start = batch_idx * BATCH_SIZE
        end = min(start + BATCH_SIZE, n_artists)

        if batch_idx % 10 == 0:
            print(f"  Batch {batch_idx + 1}/{n_batches} "
                  f"(artists {start}-{end})")

        sim_batch = cosine_similarity(matrix[start:end], matrix)

        for i in range(end - start):
            global_i = start + i
            artist_mbid = artist_mbids_set[global_i]

            # Zero out self-similarity
            sim_batch[i, global_i] = -1

            # Get top N
            top_indices = np.argpartition(sim_batch[i], -TOP_N)[-TOP_N:]
            top_indices = top_indices[np.argsort(sim_batch[i, top_indices])][::-1]

            for rank, j in enumerate(top_indices):
                sim_val = sim_batch[i, j]
                if sim_val <= 0:
                    break
                similar_mbid = artist_mbids_set[j]
                similar_name = artist_names.get(similar_mbid, 'Unknown')
                results.append((
                    artist_mbid,
                    output_name,
                    similar_mbid,
                    similar_name,
                    float(sim_val),
                    rank
                ))

    print(f"  Generated {len(results)} similarity pairs")
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--features', nargs='+', choices=list(FEATURE_MAP.keys()),
                        help='Feature sets to compute (default: all)')
    parser.add_argument('--output', default=None,
                        help='Output CSV file (default: sql/07-ab-similar.csv, or auto-named if --features given)')
    args = parser.parse_args()

    feature_map = {k: FEATURE_MAP[k] for k in args.features} if args.features else FEATURE_MAP

    if args.output:
        output_file = args.output
    elif args.features:
        output_file = 'sql/ab-similar-' + '-'.join(FEATURE_MAP[k] for k in args.features) + '.csv'
    else:
        output_file = DEFAULT_OUTPUT

    conn = psycopg2.connect(**DB_CONFIG)
    artist_names = get_artist_names(conn)

    all_results = []
    for feature_set, output_name in feature_map.items():
        results = compute_similarity_for_feature(
            conn, feature_set, output_name, artist_names
        )
        all_results.extend(results)

    conn.close()

    print(f"\nTotal similarity pairs: {len(all_results)}")
    print(f"Writing to {output_file}...")

    with open(output_file, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['artist_mbid', 'feature_set', 'similar_mbid', 'similar_name', 'similarity', 'rank'])
        writer.writerows(all_results)

    print("Done!")


if __name__ == '__main__':
    main()
