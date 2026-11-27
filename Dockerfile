# Lightweight Node.js 20 image (official Apify Actor base image - no headless Chromium needed)
FROM apify/actor-node:20

# Copy package manifests first for optimal Docker layer caching
COPY --chown=myuser:myuser package*.json ./

# Install production dependencies only
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version

# Copy Actor source code and schemas
COPY --chown=myuser:myuser . ./

# Run the Actor
CMD ["npm", "start", "--silent"]
