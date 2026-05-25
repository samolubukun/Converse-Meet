use axum::{
    routing::{get, post},
    Router,
};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

mod auth;
mod db;
mod handler;
mod ws;

use db::Db;
use ws::AppWsState;

#[tokio::main]
async fn main() {
    println!("--- Starting Converse Server ---");

    // Initialize database
    let db = Db::new("converse_db.json");

    // Initialize WebSockets state
    let ws_state = AppWsState {
        db: db.clone(),
        rooms: Arc::new(Mutex::new(HashMap::new())),
    };

    // Configure CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build routes
    let api_routes = Router::new()
        // Auth
        .route("/auth/register", post(handler::register))
        .route("/auth/login", post(handler::login))
        .route("/auth/me", get(handler::me))
        .route("/auth/logout", post(handler::logout))
        // Meetings
        .route("/meeting/create", post(handler::create_meeting))
        .route("/meeting/check_meeting_access", get(handler::check_meeting_access))
        .route("/meeting/details", get(handler::get_meeting_details))
        // State
        .with_state(db.clone());

    let ws_routes = Router::new()
        .route("/ws/meeting/:meetingId", get(ws::ws_handler))
        .with_state(ws_state);

    // Dynamic front-end serving
    // If frontend/dist exists, serve static assets. Else, serve a helpful landing message.
    let app = Router::new()
        .nest("/api", api_routes.merge(ws_routes))
        .layer(cors);

    let frontend_dir = "../frontend/dist";
    let app = if std::path::Path::new(frontend_dir).exists() {
        println!("Serving frontend assets from {}", frontend_dir);
        app.fallback_service(
            ServeDir::new(frontend_dir)
                .not_found_service(ServeFile::new(format!("{}/index.html", frontend_dir)))
        )
    } else {
        println!("Frontend build not found at {}. Running in API-only mode.", frontend_dir);
        app.fallback(axum::routing::get(|| async {
            "Converse Backend API is running! Access the React frontend via a dev server or build the frontend using 'npm run build'."
        }))
    };

    // Run the server
    let addr = SocketAddr::from(([0, 0, 0, 0], 5000));
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("Converse Server listening on http://localhost:5000");

    axum::serve(listener, app).await.unwrap();
}
