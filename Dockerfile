# Use the official Node.js image as a parent image
FROM node:20-alpine

# Create and set the working directory
WORKDIR /app

# Copy only package.json and package-lock.json (if present) first to leverage Docker cache
COPY package*.json ./

# Install dependencies (production only for smaller image)
RUN npm install --production

# Copy the rest of your application source code
COPY . .

# Inform Fly.io which port the app listens on
EXPOSE 8080

# Command to run your server
CMD ["node", "server.js"]
