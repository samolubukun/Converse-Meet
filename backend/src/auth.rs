use axum::{
    async_trait,
    extract::{FromRequestParts, FromRef},
    http::{request::Parts, StatusCode},
};
use sha2::{Digest, Sha256};
use crate::db::{Db, User};

pub fn hash_password(password: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hasher.update(salt.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn verify_password(password: &str, salt: &str, hash: &str) -> bool {
    let computed = hash_password(password, salt);
    computed == hash
}

#[derive(Clone, Debug)]
pub struct CurrentUser {
    pub user: User,
    pub token: String,
}

#[async_trait]
impl<S> FromRequestParts<S> for CurrentUser
where
    S: Send + Sync,
    Db: axum::extract::FromRef<S>,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let db = Db::from_ref(state);

        // Try extracting from Authorization header
        let mut token = None;
        if let Some(auth_header) = parts.headers.get("authorization") {
            if let Ok(auth_str) = auth_header.to_str() {
                if auth_str.to_lowercase().starts_with("bearer ") {
                    token = Some(auth_str[7..].trim().to_string());
                }
            }
        }

        // Try extracting from Cookies
        if token.is_none() {
            if let Some(cookie_header) = parts.headers.get("cookie") {
                if let Ok(cookie_str) = cookie_header.to_str() {
                    for cookie in cookie_str.split(';') {
                        let parts: Vec<&str> = cookie.split('=').map(|s| s.trim()).collect();
                        if parts.len() == 2 && parts[0] == "session_token" {
                            token = Some(parts[1].to_string());
                            break;
                        }
                    }
                }
            }
        }

        // Try extracting from Query Parameter
        if token.is_none() {
            if let Some(query_str) = parts.uri.query() {
                for pair in query_str.split('&') {
                    let kv: Vec<&str> = pair.split('=').collect();
                    if kv.len() == 2 && kv[0] == "token" {
                        token = Some(kv[1].to_string());
                        break;
                    }
                }
            }
        }

        let token = token.ok_or((StatusCode::UNAUTHORIZED, "Missing session token"))?;

        let session = db.get_session(&token).await.ok_or((
            StatusCode::UNAUTHORIZED,
            "Invalid or expired session token",
        ))?;

        let user = db.get_user(&session.user_id).await.ok_or((
            StatusCode::UNAUTHORIZED,
            "User not found for session",
        ))?;

        Ok(CurrentUser { user, token })
    }
}
