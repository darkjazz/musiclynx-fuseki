# MusicLynx Fuseki Triple Store

A reliable Apache Jena Fuseki triple store deployment for the [MusicLynx](https://musiclynx.github.io) music discovery platform, containing DBpedia music artist abstracts and categories.

## Overview

This project provides an AWS ECS deployment of Fuseki with pre-loaded music metadata to replace unreliable DBpedia SPARQL endpoints. The triple store contains:

- **Artist Abstracts** (46MB): Descriptive text about music artists from DBpedia
- **Artist Categories** (62MB): Category classifications for music artists
- **Total Dataset**: 108MB of RDF triples in Turtle format

**Note**: The TTL data files are not included in this repository due to size (108MB). You need to:
1. Extract them from DBpedia dumps yourself, or
2. Download from a separate data repository
3. Place them in the `data/` directory before building

## Quick Start

Deploy to AWS ECS (free tier eligible) with a single command:

```bash
./deploy.sh
```

This will:
1. Install dependencies
2. Deploy AWS infrastructure using CDK
3. Build and push the Docker image
4. Start the Fuseki service
5. Display the SPARQL endpoint URL

**See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions.**

## Local Development

Test locally with Docker:

```bash
# Using Docker Compose
docker-compose up

# Or manually
docker build -t musiclynx-fuseki .
docker run -p 3030:3030 musiclynx-fuseki

# Test the endpoint
curl http://localhost:3030/$/ping
curl "http://localhost:3030/musiclynx/query" \
  --data-urlencode "query=SELECT * { ?s ?p ?o } LIMIT 10"
```

## Project Structure

```
.
├── data/                          # TTL data files (108MB)
│   ├── artist_abstract_graph.ttl  # Artist abstracts (46MB)
│   └── artist_category_graph.ttl  # Artist categories (62MB)
├── fuseki/                        # Fuseki configuration
│   ├── config.ttl                 # Server configuration
│   ├── configuration/             # Dataset configurations
│   └── databases/                 # TDB2 databases (generated)
├── cdk/                           # AWS CDK infrastructure code
│   ├── lib/                       # CDK stack definitions
│   ├── bin/                       # CDK app entry point
│   └── README.md                  # CDK documentation
├── Dockerfile                     # Container image definition
├── load-data.sh                   # Data loading script
├── docker-compose.yml             # Local development setup
├── deploy.sh                      # Automated deployment script
├── get-endpoint.sh                # Get deployment endpoint URL
├── destroy.sh                     # Cleanup script
├── DEPLOYMENT.md                  # Detailed deployment guide
└── README.md                      # This file
```

## Architecture

The deployment uses:

- **Region**: eu-north-1 (Stockholm)
- **AWS CDK** for Infrastructure as Code
- **Amazon ECS on EC2** (t3.micro for free tier - 2 vCPUs, 1GB RAM)
- **Amazon ECR** for Docker image storage
- **TDB2** for efficient triple storage
- **CloudWatch** for logging

Data is pre-loaded into the Docker image for reliability and fast startup.

## SPARQL Endpoint

After deployment, the SPARQL endpoint is available at:

```
http://YOUR_PUBLIC_IP:3030/musiclynx/query
```

Example queries:

```sparql
# Get artist abstracts
SELECT ?artist ?abstract WHERE {
  ?artist <http://www.w3.org/2000/01/rdf-schema#label> ?abstract .
} LIMIT 10

# Get artist categories
SELECT ?artist ?category WHERE {
  ?artist <http://www.w3.org/2004/02/skos/core#broader> ?category .
} LIMIT 10
```

## Integration with MusicLynx

Update your MusicLynx server configuration to use this endpoint:

```javascript
// In musiclynx-server config
const FUSEKI_ENDPOINT = 'http://YOUR_PUBLIC_IP:3030/musiclynx/query';
```

## Cost

**Free tier eligible** for 12 months:
- EC2: 750 hours/month of t3.micro (covers 24/7 operation)
- ECR: 500MB storage (image is ~300-400MB)
- Data transfer: 100GB/month outbound
- CloudWatch: 5GB logs

**Estimated monthly cost**: $0 (within free tier)

After free tier: ~$8-10/month

**Bonus**: t3.micro has 2 vCPUs (vs t2.micro's 1 vCPU) for better performance!

## Deployment Options

### Automated (Recommended)

```bash
./deploy.sh
```

### Manual with CDK

```bash
cd cdk
npm install
npx cdk bootstrap
npx cdk deploy
cd ..
# Then build and push Docker image
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete manual instructions.

## Management

### Get Endpoint URL

```bash
./get-endpoint.sh
```

### View Logs

```bash
aws logs tail /ecs/musiclynx-fuseki --follow
```

### Update Image

```bash
# After modifying data or configuration
docker build -t musiclynx-fuseki .
docker tag musiclynx-fuseki:latest $ECR_REPO_URI:latest
docker push $ECR_REPO_URI:latest

aws ecs update-service \
  --cluster musiclynx-cluster \
  --service musiclynx-fuseki-service \
  --force-new-deployment
```

### Destroy Infrastructure

```bash
./destroy.sh
```

## Related Repositories

- [musiclynx](https://github.com/darkjazz/musiclynx) - MusicLynx frontend (Angular)
- [musiclynx-server](https://github.com/darkjazz/musiclynx-server) - MusicLynx server (Express.js)

## Live Deployments

- **MusicLynx UI**: https://musiclynx.github.io/#/dashboard
- **MusicLynx Server**: https://musiclynx-server.fly.dev

## Technical Details

- **Fuseki Version**: Based on `stain/jena-fuseki` Docker image
- **Storage**: TDB2 (Jena's native triple store)
- **Memory**: 768MB JVM heap (fits in 1GB instance)
- **Startup Time**: ~60 seconds (data pre-loaded)
- **Query Performance**: Local queries (no network latency to DBpedia)

## Troubleshooting

See [DEPLOYMENT.md](DEPLOYMENT.md#troubleshooting) for common issues and solutions.

## License

This project contains data from DBpedia, which is licensed under the terms of the Creative Commons Attribution-ShareAlike 3.0 License and the GNU Free Documentation License.

## Contributing

Issues and pull requests are welcome!
