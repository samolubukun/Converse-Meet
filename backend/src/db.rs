use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct User {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub full_name: String,
    pub avatar: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Meeting {
    pub id: String,
    pub meeting_type: String, // "open" or "restricted"
    pub allow_guest: bool,
    pub owner_id: String,
    pub co_hosts: Vec<String>,
    pub members: Vec<String>,
    pub waiting_room: Vec<String>,
    pub banned_users: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Session {
    pub token: String,
    pub user_id: String,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
struct DbSchema {
    users: HashMap<String, User>,
    meetings: HashMap<String, Meeting>,
    sessions: HashMap<String, Session>,
}

#[derive(Clone)]
pub struct Db {
    file_path: String,
    state: Arc<RwLock<DbSchema>>,
}

impl Db {
    pub fn new(file_path: &str) -> Self {
        let schema = Self::load_sync(file_path);
        Db {
            file_path: file_path.to_string(),
            state: Arc::new(RwLock::new(schema)),
        }
    }

    fn load_sync(file_path: &str) -> DbSchema {
        if Path::new(file_path).exists() {
            if let Ok(mut file) = File::open(file_path) {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok() {
                    if let Ok(schema) = serde_json::from_str::<DbSchema>(&content) {
                        println!("Loaded database from {}", file_path);
                        return schema;
                    }
                }
            }
        }
        println!("Initialized empty database");
        let default_schema = DbSchema::default();
        if let Ok(mut file) = File::create(file_path) {
            if let Ok(content) = serde_json::to_string_pretty(&default_schema) {
                let _ = file.write_all(content.as_bytes());
            }
        }
        default_schema
    }

    async fn save(&self) {
        let schema = self.state.read().await.clone();
        let file_path = self.file_path.clone();
        tokio::task::spawn_blocking(move || {
            if let Ok(mut file) = File::create(&file_path) {
                if let Ok(content) = serde_json::to_string_pretty(&schema) {
                    let _ = file.write_all(content.as_bytes());
                }
            }
        });
    }

    // User operations
    pub async fn get_user(&self, email: &str) -> Option<User> {
        let state = self.state.read().await;
        state.users.get(&email.to_lowercase()).cloned()
    }

    pub async fn create_user(&self, user: User) -> Result<(), &'static str> {
        let mut state = self.state.write().await;
        let email_key = user.email.to_lowercase();
        if state.users.contains_key(&email_key) {
            return Err("User already exists");
        }
        state.users.insert(email_key, user);
        drop(state);
        self.save().await;
        Ok(())
    }

    // Meeting operations
    pub async fn get_meeting(&self, id: &str) -> Option<Meeting> {
        let state = self.state.read().await;
        state.meetings.get(id).cloned()
    }

    pub async fn create_meeting(&self, meeting: Meeting) -> Result<(), &'static str> {
        let mut state = self.state.write().await;
        if state.meetings.contains_key(&meeting.id) {
            return Err("Meeting already exists");
        }
        state.meetings.insert(meeting.id.clone(), meeting);
        drop(state);
        self.save().await;
        Ok(())
    }

    pub async fn update_meeting(&self, meeting: Meeting) -> Result<(), &'static str> {
        let mut state = self.state.write().await;
        if !state.meetings.contains_key(&meeting.id) {
            return Err("Meeting not found");
        }
        state.meetings.insert(meeting.id.clone(), meeting);
        drop(state);
        self.save().await;
        Ok(())
    }

    // Session operations
    pub async fn create_session(&self, user_id: &str) -> Session {
        let mut state = self.state.write().await;
        let token = Uuid::new_v4().to_string();
        let session = Session {
            token: token.clone(),
            user_id: user_id.to_string(),
        };
        state.sessions.insert(token, session.clone());
        drop(state);
        self.save().await;
        session
    }

    pub async fn get_session(&self, token: &str) -> Option<Session> {
        let state = self.state.read().await;
        state.sessions.get(token).cloned()
    }

    pub async fn delete_session(&self, token: &str) {
        let mut state = self.state.write().await;
        state.sessions.remove(token);
        drop(state);
        self.save().await;
    }
}
