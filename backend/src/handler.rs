use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use crate::auth::{hash_password, verify_password, CurrentUser};
use crate::db::{Db, User, Meeting};

// --- Authentication Payloads & Handlers ---

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub full_name: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserResponse,
}

#[derive(Serialize)]
pub struct UserResponse {
    pub id: String,
    pub email: String,
    pub full_name: String,
    pub avatar: String,
}

pub async fn register(
    State(db): State<Db>,
    Json(payload): Json<RegisterRequest>,
) -> impl IntoResponse {
    if payload.email.trim().is_empty() || payload.password.len() < 4 {
        return (StatusCode::BAD_REQUEST, "Invalid input parameters").into_response();
    }

    let email = payload.email.to_lowercase();
    let salt = email.clone();
    let password_hash = hash_password(&payload.password, &salt);

    // Initial avatar using UI-Avatars or dicebear
    let avatar = format!(
        "https://api.dicebear.com/7.x/initials/svg?seed={}",
        urlencoding::encode(&payload.full_name)
    );

    let user = User {
        id: email.clone(),
        email,
        password_hash,
        full_name: payload.full_name,
        avatar,
    };

    match db.create_user(user.clone()).await {
        Ok(_) => {
            let session = db.create_session(&user.id).await;
            (
                StatusCode::CREATED,
                Json(AuthResponse {
                    token: session.token,
                    user: UserResponse {
                        id: user.id,
                        email: user.email,
                        full_name: user.full_name,
                        avatar: user.avatar,
                    },
                }),
            )
                .into_response()
        }
        Err(err) => (StatusCode::CONFLICT, err).into_response(),
    }
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

pub async fn login(
    State(db): State<Db>,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    let email = payload.email.to_lowercase();
    let user = match db.get_user(&email).await {
        Some(u) => u,
        None => return (StatusCode::UNAUTHORIZED, "Invalid email or password").into_response(),
    };

    if !verify_password(&payload.password, &email, &user.password_hash) {
        return (StatusCode::UNAUTHORIZED, "Invalid email or password").into_response();
    }

    let session = db.create_session(&user.id).await;
    (
        StatusCode::OK,
        Json(AuthResponse {
            token: session.token,
            user: UserResponse {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                avatar: user.avatar,
            },
        }),
    )
        .into_response()
}

pub async fn me(current_user: CurrentUser) -> impl IntoResponse {
    Json(UserResponse {
        id: current_user.user.id,
        email: current_user.user.email,
        full_name: current_user.user.full_name,
        avatar: current_user.user.avatar,
    })
}

pub async fn logout(
    State(db): State<Db>,
    current_user: CurrentUser,
) -> impl IntoResponse {
    db.delete_session(&current_user.token).await;
    StatusCode::NO_CONTENT
}

// --- Meeting Payloads & Handlers ---

#[derive(Deserialize)]
pub struct CreateMeetingRequest {
    pub meeting_type: String, // "open" or "restricted"
}

#[derive(Serialize)]
pub struct CreateMeetingResponse {
    pub meeting_code: String,
}

pub async fn create_meeting(
    State(db): State<Db>,
    current_user: CurrentUser,
    Json(payload): Json<CreateMeetingRequest>,
) -> impl IntoResponse {
    let m_type = if payload.meeting_type == "restricted" {
        "restricted".to_string()
    } else {
        "open".to_string()
    };

    // Generate meeting code xxxx-xxxx-xxxx
    let code = generate_meeting_code();

    let meeting = Meeting {
        id: code.clone(),
        meeting_type: m_type,
        allow_guest: true, // Allow guests by default
        owner_id: current_user.user.id.clone(),
        co_hosts: Vec::new(),
        members: vec![current_user.user.id.clone()],
        waiting_room: Vec::new(),
        banned_users: Vec::new(),
    };

    match db.create_meeting(meeting).await {
        Ok(_) => (StatusCode::CREATED, Json(CreateMeetingResponse { meeting_code: code })).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create meeting").into_response(),
    }
}

#[derive(Deserialize)]
pub struct CheckAccessParams {
    pub meeting_id: String,
}

#[derive(Serialize)]
pub struct CheckAccessResponse {
    pub exists: bool,
    pub allow_guest: bool,
    pub meeting_type: String,
}

pub async fn check_meeting_access(
    State(db): State<Db>,
    Query(params): Query<CheckAccessParams>,
) -> impl IntoResponse {
    match db.get_meeting(&params.meeting_id).await {
        Some(meeting) => Json(CheckAccessResponse {
            exists: true,
            allow_guest: meeting.allow_guest,
            meeting_type: meeting.meeting_type,
        })
        .into_response(),
        None => (StatusCode::NOT_FOUND, "Meeting not found").into_response(),
    }
}

#[derive(Serialize)]
pub struct MeetingDetailsResponse {
    pub id: String,
    pub meeting_type: String,
    pub allow_guest: bool,
    pub owner_id: String,
    pub owner_name: String,
    pub co_hosts: Vec<String>,
}

pub async fn get_meeting_details(
    State(db): State<Db>,
    Query(params): Query<CheckAccessParams>,
) -> impl IntoResponse {
    match db.get_meeting(&params.meeting_id).await {
        Some(meeting) => {
            let owner_name = match db.get_user(&meeting.owner_id).await {
                Some(u) => u.full_name,
                None => "Unknown Host".to_string(),
            };
            Json(MeetingDetailsResponse {
                id: meeting.id,
                meeting_type: meeting.meeting_type,
                allow_guest: meeting.allow_guest,
                owner_id: meeting.owner_id,
                owner_name,
                co_hosts: meeting.co_hosts,
            })
            .into_response()
        }
        None => (StatusCode::NOT_FOUND, "Meeting not found").into_response(),
    }
}

fn generate_meeting_code() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz".chars().collect();

    let mut segments = Vec::new();
    for _ in 0..3 {
        let seg: String = (0..4).map(|_| chars[rng.gen_range(0..chars.len())]).collect();
        segments.push(seg);
    }
    segments.join("-")
}
