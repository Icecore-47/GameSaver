# Use official Node.js LTS image
FROM node:latest

# Set working directory
WORKDIR /app

# Copy only package.json first for efficient layer caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy rest of the project files
COPY . .

# Create volume for persistent data (models.json, extracted zips)
VOLUME [ "/app/data" ]

# Expose app port
EXPOSE 3100

# Start the app
CMD ["node", "index.js"]
