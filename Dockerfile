FROM stain/jena-fuseki

# Install AWS CLI for downloading TTL files from S3
USER root
RUN apk add --no-cache aws-cli

# Copy Fuseki configuration
COPY --chown=100:100 fuseki/ /fuseki/

# Copy entrypoint script that loads data on first run
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && \
    chown 100:100 /docker-entrypoint.sh

# Switch back to Fuseki user
USER 100

# Expose Fuseki port
EXPOSE 3030

# Use custom entrypoint that loads data from S3 on first run
ENTRYPOINT ["/docker-entrypoint.sh"]
