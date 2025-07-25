# Updated to match Playwright version 1.47.0
FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy

# Set the working directory for the application
WORKDIR /app

# Install Node.js and npm
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY package*.json ./
COPY requirements.txt ./

# Install Node.js dependencies
RUN npm install --omit=dev

# Install Python dependencies
RUN pip3 install --no-cache-dir -r requirements.txt

# Set Playwright browsers path
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy the rest of your application code
COPY . .

# Expose port
EXPOSE 5000

# Start command
CMD ["npm", "start"]