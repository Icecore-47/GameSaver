# Use official Node.js LTS image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy dependency metadata first (for better cache utilization)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy remaining project files
COPY . .

# Ensure necessary runtime folders exist
RUN mkdir -p /app/data /app/uploads

# Mark /app/data as a volume for persistent storage
VOLUME [ "/app/data" ]

# Expose both HTTPS and HTTP redirect ports
EXPOSE 3100 3101

# Start the server
CMD ["node", "index.js"]
