import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import {
  Mic, MicOff, Video, VideoOff, Monitor, PhoneOff, Send, Users, MessageSquare, Hand,
  Smile, ShieldCheck, UserX, VolumeX, Check, X, AlertCircle, Copy
} from "lucide-react";
import { audioNotificationManager } from "../utils/audioNotifications";
import { getApiBase, getWsBase } from "../utils/api";

interface Peer {
  id: string;
  display_name: string;
  avatar: string;
  is_host: boolean;
  is_cohost: boolean;
  hand_raised: boolean;
  stream?: MediaStream;
}

interface ChatMessage {
  sender_id: string;
  sender_name: string;
  text: string;
  timestamp: number;
}

interface WaitingUser {
  user_id: string;
  name: string;
  avatar: string;
}

interface FloatingReaction {
  id: number;
  emoji: string;
  left: number;
  peer_id: string;
}

interface HashMap<V> {
  [key: string]: V;
}

const Meeting: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const { user, token } = useAuth();

  const [showPreview, setShowPreview] = useState(true);
  const [guestName, setGuestName] = useState("");
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);

  const [isJoined, setIsJoined] = useState(false);
  const [isWaitingForApproval, setIsWaitingForApproval] = useState(false);
  const [lobbyMessage, setLobbyMessage] = useState("");
  const [meetingOwner, setMeetingOwner] = useState("");

  const [activePanel, setActivePanel] = useState<"chat" | "people" | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [hasUnreadChat, setHasUnreadChat] = useState(false);

  const [handRaised, setHandRaised] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [waitingUsers, setWaitingUsers] = useState<WaitingUser[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [isReactionOpen, setIsReactionOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<HashMap<RTCPeerConnection>>({});
  const peersRef = useRef<Peer[]>([]);

  const myId = user?.id || `guest_${React.useId().replace(/:/g, "")}`;
  const myName = user?.full_name || guestName || "Guest";

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/meeting/check_meeting_access?meeting_id=${meetingId}`);
        if (!res.ok) throw new Error("Meeting does not exist.");
        await res.json();
        const detailsRes = await fetch(`${getApiBase()}/api/meeting/details?meeting_id=${meetingId}`);
        if (detailsRes.ok) {
          const details = await detailsRes.json();
          setMeetingOwner(details.owner_id);
        }
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to load meeting details.");
        setShowPreview(false);
      }
    };
    checkAccess();
    startPreviewMedia();
    return () => { stopLocalMedia(); };
  }, [meetingId]);

  useEffect(() => {
    if (showPreview && previewVideoRef.current && localStreamRef.current) {
      previewVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [showPreview, isCameraOn]);

  useEffect(() => {
    if (isJoined && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [isJoined, isCameraOn]);

  useEffect(() => { peersRef.current = peers; }, [peers]);

  const rtcConfig: RTCConfiguration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  const startPreviewMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      stream.getVideoTracks().forEach(t => t.enabled = isCameraOn);
      stream.getAudioTracks().forEach(t => t.enabled = isMicOn);
      if (previewVideoRef.current) previewVideoRef.current.srcObject = stream;
    } catch (err) {
      console.warn("Could not access camera/mic for preview:", err);
    }
  };

  const stopLocalMedia = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
  };

  const toggleMic = () => {
    const next = !isMicOn;
    setIsMicOn(next);
    if (localStreamRef.current) localStreamRef.current.getAudioTracks().forEach(t => t.enabled = next);
  };

  const toggleCamera = () => {
    const next = !isCameraOn;
    setIsCameraOn(next);
    if (localStreamRef.current) localStreamRef.current.getVideoTracks().forEach(t => t.enabled = next);
  };

  const handleJoin = async () => {
    if (!user && !guestName.trim()) { alert("Please enter your display name."); return; }
    setShowPreview(false);
    setIsWaitingForApproval(true);
    setLobbyMessage("Requesting to join...");

    const wsUrl = `${getWsBase()}/api/ws/meeting/${meetingId}?token=${token || ""}&guest_name=${encodeURIComponent(myName)}`;
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => console.log("WebSocket connected!");

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case "lobby_state":
          if (msg.is_waiting) {
            setIsWaitingForApproval(true);
            if (msg.message === "rejected") {
              setLobbyMessage("rejected");
              ws.close();
            } else setLobbyMessage(msg.message);
          } else {
            setIsWaitingForApproval(false);
            setIsJoined(true);
            audioNotificationManager.playJoinNotification();
          }
          break;

        case "lobby_update":
          setWaitingUsers(msg.waiting_users);
          if (msg.waiting_users.length > 0) audioNotificationManager.playJoinRequestNotification();
          break;

        case "room_joined":
          setIsWaitingForApproval(false);
          setIsJoined(true);
          setPeers(msg.peers);
          for (const ep of msg.peers) await initiatePeerConnection(ep.id, true);
          break;

        case "peer_joined":
          setPeers((prev) => prev.some(p => p.id === msg.peer.id) ? prev : [...prev, msg.peer]);
          audioNotificationManager.playJoinNotification();
          break;

        case "peer_left":
          setPeers((prev) => prev.filter((p) => p.id !== msg.peer_id));
          if (peerConnectionsRef.current[msg.peer_id]) {
            peerConnectionsRef.current[msg.peer_id].close();
            delete peerConnectionsRef.current[msg.peer_id];
          }
          audioNotificationManager.playLeaveNotification();
          break;

        case "signaling_data":
          await handleSignalingData(msg.sender_id, msg.data);
          break;

        case "chat_broadcast":
          setChatMessages((prev) => [...prev, {
            sender_id: msg.sender_id, sender_name: msg.sender_name,
            text: msg.text, timestamp: msg.timestamp,
          }]);
          if (activePanel !== "chat") setHasUnreadChat(true);
          audioNotificationManager.playChatNotification();
          break;

        case "reaction_broadcast":
          triggerReactionAnimation(msg.sender_id, msg.emoji);
          break;

        case "hand_raise_broadcast":
          setPeers((prev) => prev.map((p) => p.id === msg.sender_id ? { ...p, hand_raised: msg.raised } : p));
          if (msg.sender_id === myId) setHandRaised(msg.raised);
          else if (msg.raised) audioNotificationManager.playRaiseHandNotification();
          break;

        case "host_status_updated":
          setPeers((prev) => prev.map((p) => p.id === msg.peer_id ? { ...p, is_cohost: msg.is_cohost } : p));
          break;

        case "force_mute":
          if (isMicOn) { toggleMic(); alert("The host has muted your microphone."); }
          break;

        case "force_kick":
          alert("You have been kicked from this meeting.");
          handleDisconnect();
          break;
      }
    };

    ws.onclose = () => console.log("WebSocket disconnected.");
    ws.onerror = (err) => console.error("WebSocket error:", err);
  };

  const initiatePeerConnection = async (targetId: string, isOffer: boolean) => {
    if (peerConnectionsRef.current[targetId]) return;
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionsRef.current[targetId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        socketRef.current.send(JSON.stringify({ type: "signal", target_id: targetId, data: { candidate: e.candidate } }));
      }
    };

    pc.ontrack = (e) => {
      setPeers((prev) => prev.map((p) => p.id === targetId ? { ...p, stream: e.streams[0] } : p));
    };

    if (isOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (socketRef.current) {
        socketRef.current.send(JSON.stringify({ type: "signal", target_id: targetId, data: { sdp: offer } }));
      }
    }
  };

  const handleSignalingData = async (senderId: string, data: any) => {
    let pc = peerConnectionsRef.current[senderId];
    if (!pc) {
      await initiatePeerConnection(senderId, false);
      pc = peerConnectionsRef.current[senderId];
    }
    if (data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (socketRef.current) {
          socketRef.current.send(JSON.stringify({ type: "signal", target_id: senderId, data: { sdp: answer } }));
        }
      }
    } else if (data.candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
      catch (err) { console.warn("Failed to add ICE candidate:", err); }
    }
  };

  const sendChatMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || !socketRef.current) return;
    socketRef.current.send(JSON.stringify({ type: "chat", text: chatInput.trim() }));
    setChatInput("");
  };

  const toggleHand = () => {
    if (!socketRef.current) return;
    const next = !handRaised;
    socketRef.current.send(JSON.stringify({ type: "raise_hand", raised: next }));
  };

  const sendReaction = (emoji: string) => {
    setIsReactionOpen(false);
    if (!socketRef.current) return;
    socketRef.current.send(JSON.stringify({ type: "reaction", emoji }));
  };

  const triggerReactionAnimation = (peerId: string, emoji: string) => {
    const id = Date.now() + Math.random();
    const left = 20 + Math.random() * 60;
    setReactions((prev) => [...prev, { id, emoji, left, peer_id: peerId }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 2500);
  };

  const toggleScreenShare = async () => {
    if (!isJoined) return;
    if (isScreenSharing) {
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
      if (localStreamRef.current) {
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) {
          for (const pc of Object.values(peerConnectionsRef.current)) {
            const sender = pc.getSenders().find(s => s.track?.kind === "video");
            if (sender) sender.replaceTrack(videoTrack);
          }
        }
      }
      setIsScreenSharing(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        setIsScreenSharing(true);
        const screenTrack = stream.getVideoTracks()[0];
        screenTrack.onended = () => toggleScreenShare();
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        for (const pc of Object.values(peerConnectionsRef.current)) {
          const sender = pc.getSenders().find(s => s.track?.kind === "video");
          if (sender) sender.replaceTrack(screenTrack);
        }
      } catch (err) { console.warn("Screen share cancelled:", err); }
    }
  };

  const handleMute = (targetId: string) => {
    if (!socketRef.current) return;
    socketRef.current.send(JSON.stringify({ type: "mute_participant", target_id: targetId }));
  };

  const handleKick = (targetId: string) => {
    if (!socketRef.current) return;
    socketRef.current.send(JSON.stringify({ type: "kick_participant", target_id: targetId }));
  };

  const handlePromote = (targetId: string) => {
    if (!socketRef.current) return;
    socketRef.current.send(JSON.stringify({ type: "promote_to_cohost", target_id: targetId }));
  };

  const handleApprove = (targetId: string) => {
    if (!socketRef.current) return;
    socketRef.current.send(JSON.stringify({ type: "approve_lobby_user", target_id: targetId }));
  };

  const handleApproveAll = () => {
    if (!socketRef.current) return;
    socketRef.current.send(JSON.stringify({ type: "approve_all_lobby_users" }));
  };

  const handleReject = (targetId: string) => {
    if (!socketRef.current) return;
    socketRef.current.send(JSON.stringify({ type: "reject_lobby_user", target_id: targetId }));
  };

  const handleDisconnect = () => {
    if (socketRef.current) socketRef.current.close();
    stopLocalMedia();
    for (const pc of Object.values(peerConnectionsRef.current)) pc.close();
    peerConnectionsRef.current = {};
    setIsJoined(false);
    navigate("/");
  };

  const copyMeetingLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert("Meeting link copied to clipboard!");
  };

  const amIHost = myId === meetingOwner;
  const amICohost = peers.find(p => p.id === myId)?.is_cohost || false;
  const isHostPrivilege = amIHost || amICohost;

  const emojiList = ["👍", "❤️", "👏", "😂", "🎉", "😮"];

  // ─── Waiting screen ───
  if (isWaitingForApproval) {
    return (
      <div className="lobby-screen">
        <div className="lobby-card">
          {lobbyMessage === "rejected" ? (
            <>
              <div className="lobby-icon lobby-icon-danger">
                <X size={24} />
              </div>
              <h2 className="title">Join request rejected</h2>
              <p className="lobby-text">The host did not approve your entry request.</p>
              <button onClick={() => navigate("/")} className="btn btn-secondary btn-full">Go Home</button>
            </>
          ) : (
            <>
              <div className="spinner" />
              <h2 className="title">Waiting for approval</h2>
              <p className="lobby-text">
                This meeting is restricted. The host has been notified of your request. Please wait...
              </p>
              <button onClick={handleDisconnect} className="btn btn-secondary btn-full">Cancel Request</button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── Error screen ───
  if (errorMsg) {
    return (
      <div className="error-screen">
        <div className="error-card">
          <AlertCircle size={40} color="var(--red)" />
          <h2 className="title">Access Blocked</h2>
          <p>{errorMsg}</p>
          <button onClick={() => navigate("/")} className="btn btn-primary btn-full">Return to Home</button>
        </div>
      </div>
    );
  }

  // ─── Preview screen ───
  if (showPreview) {
    return (
      <div className="preview-screen">
        <div className="preview-card">
          <div className="preview-video-wrap">
            <div className="video-tile" style={{ background: "#0a0c10", aspectRatio: "4/3", border: "1px solid var(--border)" }}>
              {isCameraOn ? (
                <video ref={previewVideoRef} autoPlay playsInline muted style={{ transform: "scaleX(-1)" }} />
              ) : (
                <div className="avatar-lg" style={{ position: "absolute" }}>
                  {myName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="preview-controls">
                <button onClick={toggleMic} className={`btn btn-icon-sm ${isMicOn ? "btn-secondary" : "btn-danger"}`}>
                  {isMicOn ? <Mic size={16} /> : <MicOff size={16} />}
                </button>
                <button onClick={toggleCamera} className={`btn btn-icon-sm ${isCameraOn ? "btn-secondary" : "btn-danger"}`}>
                  {isCameraOn ? <Video size={16} /> : <VideoOff size={16} />}
                </button>
              </div>
            </div>
          </div>

          <div className="preview-info">
            <h2>Ready to Join?</h2>
            <p className="preview-code">
              Meeting Code: <strong>{meetingId}</strong>
            </p>

            {!user && (
              <div className="form-group" style={{ marginBottom: 18 }}>
                <label className="form-label">Display Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter your name"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  style={{ paddingLeft: 14 }}
                />
              </div>
            )}

            <button onClick={handleJoin} className="btn btn-primary btn-full" style={{ padding: "13px", fontSize: "0.95rem" }}>
              Join Meeting
            </button>
            <button onClick={() => navigate("/")} className="btn btn-secondary btn-full" style={{ marginTop: 8 }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main Room ───
  return (
    <div className="room">
      <header className="room-header">
        <div className="room-header-info">
          <h4>Converse Room</h4>
          <span>Code: {meetingId}</span>
        </div>
        <button onClick={copyMeetingLink} className="btn btn-secondary btn-sm">
          <Copy size={14} />
          <span>Copy Link</span>
        </button>
      </header>

      <div className="viewport">
        <div className="video-area">
          <div className={`video-grid grid-${Math.min(peers.length + 1, 9)}`}>
            <div className={`video-tile ${!isMicOn ? "video-tile-muted" : ""}`}>
              {isCameraOn ? (
                <video ref={localVideoRef} autoPlay playsInline muted style={{ transform: isScreenSharing ? "none" : "scaleX(-1)" }} />
              ) : (
                <div className="avatar-lg">{myName.slice(0, 2).toUpperCase()}</div>
              )}
              {reactions.filter((r) => r.peer_id === myId).map((r) => (
                <span key={r.id} className="floating-reaction" style={{ left: `${r.left}%` }}>{r.emoji}</span>
              ))}
              <div className="tile-info">
                <span>{myName} (You)</span>
                {!isMicOn && <MicOff size={13} color="#f87171" />}
                {handRaised && <Hand size={13} color="#fbbf24" fill="#fbbf24" />}
              </div>
            </div>

            {peers.map((peer) => (
              <div key={peer.id} className="video-tile">
                {peer.stream && peer.stream.getVideoTracks().length > 0 ? (
                  <video ref={(el) => { if (el && peer.stream) el.srcObject = peer.stream; }} autoPlay playsInline />
                ) : (
                  <div className="avatar-lg">{peer.display_name.slice(0, 2).toUpperCase()}</div>
                )}
                {reactions.filter((r) => r.peer_id === peer.id).map((r) => (
                  <span key={r.id} className="floating-reaction" style={{ left: `${r.left}%` }}>{r.emoji}</span>
                ))}
                <div className="tile-info">
                  <span>{peer.display_name}</span>
                  {peer.is_host && <ShieldCheck size={13} color="var(--primary)" />}
                  {peer.is_cohost && <ShieldCheck size={13} color="var(--green)" />}
                  {peer.hand_raised && <Hand size={13} color="#fbbf24" fill="#fbbf24" />}
                </div>
              </div>
            ))}
          </div>
        </div>

        {activePanel && (
          <div className="panel">
            <div className="panel-header">
              <h3>{activePanel === "chat" ? "Text Chat" : "Participants"}</h3>
              <button onClick={() => setActivePanel(null)} className="btn btn-ghost btn-icon-sm">
                <X size={15} />
              </button>
            </div>

            {activePanel === "chat" && (
              <>
                <div className="panel-body">
                  {chatMessages.length === 0 ? (
                    <div className="chat-empty">No messages yet. Send a message to start!</div>
                  ) : (
                    chatMessages.map((msg, idx) => (
                      <div key={idx} className={`chat-msg ${msg.sender_id === myId ? "chat-msg-mine" : "chat-msg-other"}`}>
                        <span className="chat-msg-name">{msg.sender_name}</span>
                        <div className="chat-msg-bubble">{msg.text}</div>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={sendChatMessage} className="chat-input-wrap">
                  <input
                    type="text"
                    placeholder="Type message..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary btn-icon-sm">
                    <Send size={15} />
                  </button>
                </form>
              </>
            )}

            {activePanel === "people" && (
              <div className="panel-body">
                {isHostPrivilege && waitingUsers.length > 0 && (
                  <div className="lobby-requests">
                    <h4>Lobby Join Requests ({waitingUsers.length})</h4>
                    {waitingUsers.map((w) => (
                      <div key={w.user_id} className="lobby-request-item">
                        <span className="lobby-request-name">{w.name}</span>
                        <div className="lobby-request-actions">
                          <button onClick={() => handleApprove(w.user_id)} className="btn btn-primary btn-icon-sm" style={{ background: "var(--green)" }}>
                            <Check size={12} />
                          </button>
                          <button onClick={() => handleReject(w.user_id)} className="btn btn-danger btn-icon-sm">
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                    <button onClick={handleApproveAll} className="btn btn-secondary btn-sm btn-full" style={{ marginTop: 6 }}>
                      Approve All
                    </button>
                  </div>
                )}

                <div className="participants-header">Connected ({peers.length + 1})</div>

                <div className="participant-item">
                  <span className="participant-name" style={{ fontWeight: 600 }}>{myName} (You)</span>
                  {amIHost && <span className="badge badge-primary">Host</span>}
                </div>

                {peers.map((p) => (
                  <div key={p.id} className="participant-item">
                    <div>
                      <span className="participant-name">{p.display_name}</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        {p.is_host && <span className="badge badge-primary">Host</span>}
                        {p.is_cohost && <span className="badge badge-green">Co-Host</span>}
                      </div>
                    </div>
                    {isHostPrivilege && p.id !== myId && (
                      <div className="participant-actions">
                        <button onClick={() => handleMute(p.id)} className="btn btn-ghost btn-icon-sm" title="Force Mute">
                          <VolumeX size={14} />
                        </button>
                        {amIHost && !p.is_cohost && (
                          <button onClick={() => handlePromote(p.id)} className="btn btn-ghost btn-icon-sm" title="Make Co-Host">
                            <ShieldCheck size={14} />
                          </button>
                        )}
                        <button onClick={() => handleKick(p.id)} className="btn btn-ghost btn-icon-sm" title="Kick User" style={{ color: "var(--red)" }}>
                          <UserX size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="toolbar-area">
        <div className="toolbar">
          <button onClick={toggleMic} className={`btn btn-icon ${isMicOn ? "btn-secondary" : "btn-danger"}`}>
            {isMicOn ? <Mic size={19} /> : <MicOff size={19} />}
          </button>
          <button onClick={toggleCamera} className={`btn btn-icon ${isCameraOn ? "btn-secondary" : "btn-danger"}`}>
            {isCameraOn ? <Video size={19} /> : <VideoOff size={19} />}
          </button>
          <button onClick={toggleScreenShare} className={`btn btn-icon ${isScreenSharing ? "btn-primary" : "btn-secondary"}`}>
            <Monitor size={19} />
          </button>
          <button onClick={toggleHand} className={`btn btn-icon ${handRaised ? "btn-primary" : "btn-secondary"}`}>
            <Hand size={19} fill={handRaised ? "white" : "none"} />
          </button>

          <div style={{ position: "relative" }}>
            <button onClick={() => setIsReactionOpen(!isReactionOpen)} className={`btn btn-icon ${isReactionOpen ? "btn-primary" : "btn-secondary"}`}>
              <Smile size={19} />
            </button>
            {isReactionOpen && (
              <div className="reaction-picker">
                {emojiList.map((emoji) => (
                  <button key={emoji} onClick={() => sendReaction(emoji)} className="reaction-btn">{emoji}</button>
                ))}
              </div>
            )}
          </div>

          <div className="toolbar-divider" />

          <button
            onClick={() => { setActivePanel(activePanel === "chat" ? null : "chat"); setHasUnreadChat(false); }}
            className={`btn btn-icon ${activePanel === "chat" ? "btn-primary" : "btn-secondary"}`}
            style={{ position: "relative" }}
          >
            <MessageSquare size={19} />
            {hasUnreadChat && <span className="unread-dot" />}
          </button>

          <button
            onClick={() => setActivePanel(activePanel === "people" ? null : "people")}
            className={`btn btn-icon ${activePanel === "people" ? "btn-primary" : "btn-secondary"}`}
          >
            <Users size={19} />
          </button>

          <button onClick={handleDisconnect} className="btn btn-danger btn-icon">
            <PhoneOff size={19} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Meeting;
