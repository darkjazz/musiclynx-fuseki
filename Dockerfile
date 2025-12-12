FROM stain/jena-fuseki

# Copy Fuseki configuration (includes pre-built database)
COPY --chown=100:100 fuseki/ /fuseki/

# Expose Fuseki port
EXPOSE 3030

# Use default Fuseki entrypoint
# Data is already loaded in the database
