use axum::{
    extract::{Path, Query, State, WebSocketUpgrade, ws::{Message, WebSocket}},
    response::IntoResponse,
    http::StatusCode,
};
use futures_util::{StreamExt, SinkExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use crate::db::Db;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsMessage {
    // Client -> Server
    Join {
        display_name: String,
        avatar: String,
    },
    Signal {
        target_id: String,
        data: serde_json::Value,
    },
    Chat {
        text: String,
    },
    Reaction {
        emoji: String,
    },
    RaiseHand {
        raised: bool,
    },
    // Host -> Server Controls
    MuteParticipant {
        target_id: String,
    },
    KickParticipant {
        target_id: String,
    },
    PromoteToCohost {
        target_id: String,
    },
    ApproveLobbyUser {
        target_id: String,
    },
    ApproveAllLobbyUsers,
    RejectLobbyUser {
        target_id: String,
    },

    // Server -> Client
    LobbyState {
        is_waiting: bool,
        message: String,
    },
    LobbyUpdate {
        waiting_users: Vec<WaitingUserInfo>,
    },
    RoomJoined {
        peers: Vec<PeerInfo>,
    },
    PeerJoined {
        peer: PeerInfo,
    },
    PeerLeft {
        peer_id: String,
    },
    SignalingData {
        sender_id: String,
        data: serde_json::Value,
    },
    ChatBroadcast {
        sender_id: String,
        sender_name: String,
        text: String,
        timestamp: i64,
    },
    ReactionBroadcast {
        sender_id: String,
        emoji: String,
    },
    HandRaiseBroadcast {
        sender_id: String,
        raised: bool,
    },
    HostStatusUpdated {
        peer_id: String,
        is_cohost: bool,
    },
    ForceMute,
    ForceKick,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PeerInfo {
    pub id: String,
    pub display_name: String,
    pub avatar: String,
    pub is_host: bool,
    pub is_cohost: bool,
    pub hand_raised: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WaitingUserInfo {
    pub user_id: String,
    pub name: String,
    pub avatar: String,
}

pub struct Peer {
    pub id: String,
    pub display_name: String,
    pub avatar: String,
    pub is_host: bool,
    pub is_cohost: bool,
    pub hand_raised: bool,
    pub tx: mpsc::UnboundedSender<Message>,
}

pub struct WaitingPeer {
    pub id: String,
    pub display_name: String,
    pub avatar: String,
    pub tx: mpsc::UnboundedSender<Message>,
}

pub struct Room {
    pub peers: HashMap<String, Peer>,
    pub waiting_room: HashMap<String, WaitingPeer>,
}

#[derive(Clone)]
pub struct AppWsState {
    pub db: Db,
    pub rooms: Arc<Mutex<HashMap<String, Room>>>,
}

#[derive(Deserialize)]
pub struct WsQuery {
    pub token: Option<String>,
    pub guest_name: Option<String>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(meeting_id): Path<String>,
    Query(query): Query<WsQuery>,
    State(ws_state): State<AppWsState>,
) -> impl IntoResponse {
    // Validate meeting exists
    let meeting = match ws_state.db.get_meeting(&meeting_id).await {
        Some(m) => m,
        None => return (StatusCode::NOT_FOUND, "Meeting not found").into_response(),
    };

    // Determine authentication
    let mut authenticated_user = None;
    if let Some(ref t) = query.token {
        if let Some(session) = ws_state.db.get_session(t).await {
            if let Some(user) = ws_state.db.get_user(&session.user_id).await {
                authenticated_user = Some(user);
            }
        }
    }

    let is_host = if let Some(ref u) = authenticated_user {
        u.id == meeting.owner_id
    } else {
        false
    };

    let is_cohost = if let Some(ref u) = authenticated_user {
        meeting.co_hosts.contains(&u.id)
    } else {
        false
    };

    // If restricted meeting and no authenticated user, or authenticated user who is not owner/cohost/approved member, check waiting room.
    let needs_approval = meeting.meeting_type == "restricted" 
        && !is_host 
        && !is_cohost
        && (authenticated_user.is_none() || !meeting.members.contains(&authenticated_user.as_ref().unwrap().id));

    // Guests must provide a guest name
    let (user_id, display_name, avatar) = match authenticated_user {
        Some(u) => (u.id, u.full_name, u.avatar),
        None => {
            if !meeting.allow_guest {
                return (StatusCode::FORBIDDEN, "Guests are not allowed in this meeting").into_response();
            }
            let guest_name = query.guest_name.unwrap_or_else(|| "Guest".to_string());
            let rand_id = format!("guest_{}", rand::random::<u16>());
            let avatar = format!("https://api.dicebear.com/7.x/bottts/svg?seed={}", rand_id);
            (rand_id, guest_name, avatar)
        }
    };

    ws.on_upgrade(move |socket| handle_socket(
        socket, 
        ws_state, 
        meeting_id, 
        user_id, 
        display_name, 
        avatar, 
        is_host, 
        is_cohost, 
        needs_approval
    ))
}

async fn handle_socket(
    socket: WebSocket,
    ws_state: AppWsState,
    meeting_id: String,
    user_id: String,
    display_name: String,
    avatar: String,
    is_host: bool,
    is_cohost: bool,
    needs_approval: bool,
) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel();

    // Spawn tx forwarder
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Helper to send typed message
    let send_msg = |tx: &mpsc::UnboundedSender<Message>, msg: WsMessage| {
        if let Ok(json_str) = serde_json::to_string(&msg) {
            let _ = tx.send(Message::Text(json_str));
        }
    };

    // Add to rooms
    let mut rooms = ws_state.rooms.lock().await;
    let room = rooms.entry(meeting_id.clone()).or_insert_with(|| Room {
        peers: HashMap::new(),
        waiting_room: HashMap::new(),
    });

    if needs_approval {
        // Put in waiting room
        room.waiting_room.insert(
            user_id.clone(),
            WaitingPeer {
                id: user_id.clone(),
                display_name: display_name.clone(),
                avatar: avatar.clone(),
                tx: tx.clone(),
            },
        );

        // Notify user they are waiting
        send_msg(&tx, WsMessage::LobbyState {
            is_waiting: true,
            message: "Waiting for host approval...".to_string(),
        });

        // Notify existing host/cohosts
        let waiting_info: Vec<WaitingUserInfo> = room.waiting_room.values().map(|wp| WaitingUserInfo {
            user_id: wp.id.clone(),
            name: wp.display_name.clone(),
            avatar: wp.avatar.clone(),
        }).collect();

        for peer in room.peers.values() {
            if peer.is_host || peer.is_cohost {
                send_msg(&peer.tx, WsMessage::LobbyUpdate {
                    waiting_users: waiting_info.clone(),
                });
            }
        }
    } else {
        // Join meeting immediately
        let peer_info = PeerInfo {
            id: user_id.clone(),
            display_name: display_name.clone(),
            avatar: avatar.clone(),
            is_host,
            is_cohost,
            hand_raised: false,
        };

        // Notify newly joined user of existing peers
        let existing_peers: Vec<PeerInfo> = room.peers.values().map(|p| PeerInfo {
            id: p.id.clone(),
            display_name: p.display_name.clone(),
            avatar: p.avatar.clone(),
            is_host: p.is_host,
            is_cohost: p.is_cohost,
            hand_raised: p.hand_raised,
        }).collect();

        send_msg(&tx, WsMessage::RoomJoined { peers: existing_peers });

        // Notify existing peers of new peer
        for peer in room.peers.values() {
            send_msg(&peer.tx, WsMessage::PeerJoined { peer: peer_info.clone() });
        }

        // Add to active peers
        room.peers.insert(
            user_id.clone(),
            Peer {
                id: user_id.clone(),
                display_name: display_name.clone(),
                avatar: avatar.clone(),
                is_host,
                is_cohost,
                hand_raised: false,
                tx: tx.clone(),
            },
        );

        // Also push the waiting room list if they are host/cohost
        if is_host || is_cohost {
            let waiting_info: Vec<WaitingUserInfo> = room.waiting_room.values().map(|wp| WaitingUserInfo {
                user_id: wp.id.clone(),
                name: wp.display_name.clone(),
                avatar: wp.avatar.clone(),
            }).collect();
            send_msg(&tx, WsMessage::LobbyUpdate { waiting_users: waiting_info });
        }
    }

    drop(rooms);

    // Read loop
    while let Some(Ok(Message::Text(text))) = stream.next().await {
        if let Ok(msg) = serde_json::from_str::<WsMessage>(&text) {
            let mut rooms = ws_state.rooms.lock().await;
            let room = match rooms.get_mut(&meeting_id) {
                Some(r) => r,
                None => break,
            };

            // Check if current user is active or in waiting room
            let is_active = room.peers.contains_key(&user_id);
            let p_host = room.peers.get(&user_id).map(|p| p.is_host).unwrap_or(false);
            let p_cohost = room.peers.get(&user_id).map(|p| p.is_cohost).unwrap_or(false);
            let is_authorized = p_host || p_cohost;

            if !is_active && !needs_approval {
                break;
            }

            match msg {
                WsMessage::Signal { target_id, data } => {
                    if let Some(target) = room.peers.get(&target_id) {
                        send_msg(&target.tx, WsMessage::SignalingData {
                            sender_id: user_id.clone(),
                            data,
                        });
                    }
                }
                WsMessage::Chat { text } => {
                    let timestamp = chrono::Utc::now().timestamp_millis();
                    for peer in room.peers.values() {
                        send_msg(&peer.tx, WsMessage::ChatBroadcast {
                            sender_id: user_id.clone(),
                            sender_name: display_name.clone(),
                            text: text.clone(),
                            timestamp,
                        });
                    }
                }
                WsMessage::Reaction { emoji } => {
                    for peer in room.peers.values() {
                        send_msg(&peer.tx, WsMessage::ReactionBroadcast {
                            sender_id: user_id.clone(),
                            emoji: emoji.clone(),
                        });
                    }
                }
                WsMessage::RaiseHand { raised } => {
                    if let Some(p) = room.peers.get_mut(&user_id) {
                        p.hand_raised = raised;
                    }
                    for peer in room.peers.values() {
                        send_msg(&peer.tx, WsMessage::HandRaiseBroadcast {
                            sender_id: user_id.clone(),
                            raised,
                        });
                    }
                }
                // Host controls
                WsMessage::MuteParticipant { target_id } => {
                    if is_authorized {
                        if let Some(target) = room.peers.get(&target_id) {
                            send_msg(&target.tx, WsMessage::ForceMute);
                        }
                    }
                }
                WsMessage::KickParticipant { target_id } => {
                    if is_authorized {
                        if let Some(target) = room.peers.get(&target_id) {
                            send_msg(&target.tx, WsMessage::ForceKick);
                        }
                    }
                }
                WsMessage::PromoteToCohost { target_id } => {
                    if p_host {
                        if let Some(target) = room.peers.get_mut(&target_id) {
                            target.is_cohost = true;
                            // Update meeting in database
                            if let Some(mut m) = ws_state.db.get_meeting(&meeting_id).await {
                                if !m.co_hosts.contains(&target_id) {
                                    m.co_hosts.push(target_id.clone());
                                    let _ = ws_state.db.update_meeting(m).await;
                                }
                            }
                            // Broadcast status update
                            for peer in room.peers.values() {
                                send_msg(&peer.tx, WsMessage::HostStatusUpdated {
                                    peer_id: target_id.clone(),
                                    is_cohost: true,
                                });
                            }
                        }
                    }
                }
                WsMessage::ApproveLobbyUser { target_id } => {
                    if is_authorized {
                        if let Some(wp) = room.waiting_room.remove(&target_id) {
                            // Convert to active peer
                            let peer_info = PeerInfo {
                                id: wp.id.clone(),
                                display_name: wp.display_name.clone(),
                                avatar: wp.avatar.clone(),
                                is_host: false,
                                is_cohost: false,
                                hand_raised: false,
                            };

                            // Add meeting member in DB
                            if let Some(mut m) = ws_state.db.get_meeting(&meeting_id).await {
                                if !m.members.contains(&target_id) {
                                    m.members.push(target_id.clone());
                                    let _ = ws_state.db.update_meeting(m).await;
                                }
                            }

                            // Notify wait user of approval and send existing peer details
                            let existing_peers: Vec<PeerInfo> = room.peers.values().map(|p| PeerInfo {
                                id: p.id.clone(),
                                display_name: p.display_name.clone(),
                                avatar: p.avatar.clone(),
                                is_host: p.is_host,
                                is_cohost: p.is_cohost,
                                hand_raised: p.hand_raised,
                            }).collect();

                            send_msg(&wp.tx, WsMessage::LobbyState {
                                is_waiting: false,
                                message: "Approved!".to_string(),
                            });
                            send_msg(&wp.tx, WsMessage::RoomJoined { peers: existing_peers });

                            // Notify all existing active peers of new approved peer
                            for peer in room.peers.values() {
                                send_msg(&peer.tx, WsMessage::PeerJoined { peer: peer_info.clone() });
                            }

                            // Put peer into active peers
                            room.peers.insert(
                                target_id.clone(),
                                Peer {
                                    id: wp.id.clone(),
                                    display_name: wp.display_name.clone(),
                                    avatar: wp.avatar.clone(),
                                    is_host: false,
                                    is_cohost: false,
                                    hand_raised: false,
                                    tx: wp.tx.clone(),
                                },
                            );

                            // Send updated lobby status to hosts
                            let waiting_info: Vec<WaitingUserInfo> = room.waiting_room.values().map(|p| WaitingUserInfo {
                                user_id: p.id.clone(),
                                name: p.display_name.clone(),
                                avatar: p.avatar.clone(),
                            }).collect();

                            for peer in room.peers.values() {
                                if peer.is_host || peer.is_cohost {
                                    send_msg(&peer.tx, WsMessage::LobbyUpdate { waiting_users: waiting_info.clone() });
                                }
                            }
                        }
                    }
                }
                WsMessage::ApproveAllLobbyUsers => {
                    if is_authorized {
                        let wait_ids: Vec<String> = room.waiting_room.keys().cloned().collect();
                        for target_id in wait_ids {
                            if let Some(wp) = room.waiting_room.remove(&target_id) {
                                let peer_info = PeerInfo {
                                    id: wp.id.clone(),
                                    display_name: wp.display_name.clone(),
                                    avatar: wp.avatar.clone(),
                                    is_host: false,
                                    is_cohost: false,
                                    hand_raised: false,
                                };

                                if let Some(mut m) = ws_state.db.get_meeting(&meeting_id).await {
                                    if !m.members.contains(&target_id) {
                                        m.members.push(target_id.clone());
                                        let _ = ws_state.db.update_meeting(m).await;
                                    }
                                }

                                let existing_peers: Vec<PeerInfo> = room.peers.values().map(|p| PeerInfo {
                                    id: p.id.clone(),
                                    display_name: p.display_name.clone(),
                                    avatar: p.avatar.clone(),
                                    is_host: p.is_host,
                                    is_cohost: p.is_cohost,
                                    hand_raised: p.hand_raised,
                                }).collect();

                                send_msg(&wp.tx, WsMessage::LobbyState {
                                    is_waiting: false,
                                    message: "Approved!".to_string(),
                                });
                                send_msg(&wp.tx, WsMessage::RoomJoined { peers: existing_peers });

                                for peer in room.peers.values() {
                                    send_msg(&peer.tx, WsMessage::PeerJoined { peer: peer_info.clone() });
                                }

                                room.peers.insert(
                                    target_id.clone(),
                                    Peer {
                                        id: wp.id.clone(),
                                        display_name: wp.display_name.clone(),
                                        avatar: wp.avatar.clone(),
                                        is_host: false,
                                        is_cohost: false,
                                        hand_raised: false,
                                        tx: wp.tx.clone(),
                                    },
                                );
                            }
                        }

                        // Broadcast empty waiting room to hosts
                        for peer in room.peers.values() {
                            if peer.is_host || peer.is_cohost {
                                send_msg(&peer.tx, WsMessage::LobbyUpdate { waiting_users: Vec::new() });
                            }
                        }
                    }
                }
                WsMessage::RejectLobbyUser { target_id } => {
                    if is_authorized {
                        if let Some(wp) = room.waiting_room.remove(&target_id) {
                            send_msg(&wp.tx, WsMessage::LobbyState {
                                is_waiting: true,
                                message: "rejected".to_string(),
                            });
                            // Notify other hosts
                            let waiting_info: Vec<WaitingUserInfo> = room.waiting_room.values().map(|p| WaitingUserInfo {
                                user_id: p.id.clone(),
                                name: p.display_name.clone(),
                                avatar: p.avatar.clone(),
                            }).collect();

                            for peer in room.peers.values() {
                                if peer.is_host || peer.is_cohost {
                                    send_msg(&peer.tx, WsMessage::LobbyUpdate { waiting_users: waiting_info.clone() });
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    // Cleanup on disconnect
    let mut rooms = ws_state.rooms.lock().await;
    if let Some(room) = rooms.get_mut(&meeting_id) {
        room.waiting_room.remove(&user_id);
        
        let removed_peer = room.peers.remove(&user_id);

        if removed_peer.is_some() {
            // Notify other active peers that this peer left
            for peer in room.peers.values() {
                send_msg(&peer.tx, WsMessage::PeerLeft {
                    peer_id: user_id.clone(),
                });
            }
        }

        // Notify hosts of updated waiting room in case they were waiting
        let waiting_info: Vec<WaitingUserInfo> = room.waiting_room.values().map(|p| WaitingUserInfo {
            user_id: p.id.clone(),
            name: p.display_name.clone(),
            avatar: p.avatar.clone(),
        }).collect();

        for peer in room.peers.values() {
            if peer.is_host || peer.is_cohost {
                send_msg(&peer.tx, WsMessage::LobbyUpdate {
                    waiting_users: waiting_info.clone(),
                });
            }
        }

        // Clean up empty room
        if room.peers.is_empty() && room.waiting_room.is_empty() {
            rooms.remove(&meeting_id);
        }
    }
}
