FROM stain/jena-fuseki

# Copy Fuseki configuration (includes pre-built database)
COPY --chown=100:100 fuseki/ /fuseki/

# Ensure database directory has correct permissions for runtime
# Fuseki needs to create lock files when it starts (user 100 needs write access)
RUN chmod -R 775 /fuseki/databases/musiclynx

# Expose Fuseki port
EXPOSE 3030

# Use default Fuseki entrypoint
# Data is already loaded in the database
