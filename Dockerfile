# ==========================================
# STAGE 1: Build the Vite React Frontend
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Copy dependency configs
COPY frontend/package*.json ./

# Install packages (using legacy-peer-deps to ignore React 19/Lucide conflicts)
RUN npm ci --legacy-peer-deps

# Copy frontend source files
COPY frontend/ ./

# Compile production Vite React application
RUN npm run build

# ==========================================
# STAGE 2: Build the High-Performance Rust Backend
# ==========================================
FROM rust:1.86-slim AS backend-builder
WORKDIR /app/backend

# Install necessary build tools for compiling Rust dependencies
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Copy backend configurations and source files
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src/ ./src/

# Compile optimized release binary
RUN cargo build --release

# ==========================================
# STAGE 3: Minimal and Secure Final Runtime
# ==========================================
FROM debian:bookworm-slim AS runtime

# Create a non-root user with UID 1000 to comply with Hugging Face Spaces security
RUN useradd -m -u 1000 appuser

WORKDIR /app/backend

# Install standard dependencies for OpenSSL/WebRTC network support
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

# Copy compiled backend release binary from Stage 2
COPY --from=backend-builder /app/backend/target/release/backend ./backend

# Copy compiled static frontend assets from Stage 1 into the exact relative folder structure
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Grant ownership of the entire app directory to user 1000 so database file writes succeed
RUN chown -R appuser:appuser /app

# Switch to the non-root user
USER appuser

# Hugging Face Spaces expects the container to listen on port 7860
ENV PORT=7860
ENV RUST_LOG=info
EXPOSE 7860

# Run the unified Rust server
CMD ["./backend"]

