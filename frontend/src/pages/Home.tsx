import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { Video, Plus, Key, LogOut, ArrowRight, Settings, ShieldAlert, Sparkles } from "lucide-react";

const Home: React.FC = () => {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const [meetingCode, setMeetingCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const code = meetingCode.trim();
    if (!code) {
      setError("Please enter a meeting code.");
      return;
    }

    // Validate meeting code format xxxx-xxxx-xxxx
    const regex = /^[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}$/;
    if (!regex.test(code)) {
      setError("Format must be xxxx-xxxx-xxxx");
      return;
    }

    navigate(`/${code}`);
  };

  const startMeeting = async (meetingType: "open" | "restricted") => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("http://localhost:5000/api/meeting/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ meeting_type: meetingType }),
      });

      if (!res.ok) {
        throw new Error("Failed to create meeting.");
      }

      const data = await res.json();
      navigate(`/${data.meeting_code}`);
    } catch (err: any) {
      setError(err.message || "Could not start meeting.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      
      {/* Top Navbar */}
      <header className="glass-panel" style={{
        margin: "20px",
        padding: "15px 30px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-glass)"
      }}>
        <div className="flex-center" style={{ gap: "10px" }}>
          <div className="flex-center" style={{
            width: "40px",
            height: "40px",
            background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
            borderRadius: "10px"
          }}>
            <Video size={22} color="white" />
          </div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", fontWeight: "700" }}>Converse</h2>
        </div>

        <div className="flex-center" style={{ gap: "16px" }}>
          <div className="flex-center" style={{ gap: "10px" }}>
            <img src={user?.avatar || ""} alt="Avatar" style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              border: "2px solid var(--primary)"
            }} />
            <span style={{ fontSize: "0.95rem", fontWeight: "600", color: "var(--text-primary)" }}>
              {user?.full_name}
            </span>
          </div>
          <button onClick={logout} className="btn btn-secondary" style={{ padding: "8px 14px", fontSize: "0.85rem" }}>
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Main Section */}
      <main style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px"
      }}>
        <div className="glass-panel" style={{
          width: "100%",
          maxWidth: "580px",
          padding: "50px 40px",
          textAlign: "center",
          position: "relative",
          overflow: "hidden"
        }}>
          
          {/* Subtle design element */}
          <div style={{
            position: "absolute",
            top: "-50px",
            right: "-50px",
            width: "150px",
            height: "150px",
            background: "radial-gradient(circle, rgba(99,102,241,0.2) 0%, rgba(0,0,0,0) 70%)",
            pointerEvents: "none"
          }} />

          <div className="flex-center hover-scale" style={{
            width: "48px",
            height: "48px",
            background: "rgba(99, 102, 241, 0.1)",
            color: "var(--primary)",
            borderRadius: "50%",
            margin: "0 auto 20px"
          }}>
            <Sparkles size={24} />
          </div>

          <h1 style={{
            fontFamily: "var(--font-display)",
            fontSize: "2.4rem",
            fontWeight: "800",
            letterSpacing: "-0.03em",
            marginBottom: "15px",
            background: "linear-gradient(to right, #ffffff, #9ca3af)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>
            Instant Meetings & P2P Video
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "1.05rem", marginBottom: "40px", lineHeight: "1.6" }}>
            Secure, premium browser-based video calls with crystal-clear audio, dynamic screensharing, raise hand queue, and real-time host validation rooms.
          </p>

          {error && (
            <div className="flex-center" style={{
              background: "rgba(239, 68, 68, 0.15)",
              borderRadius: "10px",
              padding: "12px",
              color: "#f87171",
              fontSize: "0.9rem",
              gap: "8px",
              marginBottom: "24px"
            }}>
              <ShieldAlert size={18} />
              <span>{error}</span>
            </div>
          )}

          {/* Join Call Form */}
          <form onSubmit={handleJoin} style={{ display: "flex", gap: "12px", marginBottom: "30px", justifyContent: "center" }}>
            <div style={{ flex: 1, position: "relative", maxWidth: "300px" }}>
              <Key size={18} color="var(--text-muted)" style={{ position: "absolute", left: "14px", top: "16px" }} />
              <input
                type="text"
                className="form-input"
                placeholder="abcd-efgh-ijkl"
                value={meetingCode}
                onChange={(e) => setMeetingCode(e.target.value)}
                style={{ width: "100%", paddingLeft: "42px", textAlign: "left" }}
              />
            </div>
            <button type="submit" className="btn btn-secondary hover-scale" style={{ padding: "14px 24px" }}>
              <span>Join</span>
              <ArrowRight size={16} />
            </button>
          </form>

          <div style={{ display: "flex", alignItems: "center", margin: "25px 0", color: "var(--text-muted)" }}>
            <hr style={{ flex: 1, border: "0", borderTop: "1px solid var(--border-glass)" }} />
            <span style={{ padding: "0 15px", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>or</span>
            <hr style={{ flex: 1, border: "0", borderTop: "1px solid var(--border-glass)" }} />
          </div>

          {/* Start New Meeting Actions */}
          <div style={{ display: "flex", gap: "14px", justifyContent: "center", position: "relative" }}>
            <button
              onClick={() => startMeeting("open")}
              disabled={loading}
              className="btn btn-primary hover-scale"
              style={{ padding: "14px 28px", flex: "1", maxWidth: "240px" }}
            >
              <Plus size={18} />
              <span>Start New Meeting</span>
            </button>

            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              disabled={loading}
              className="btn btn-secondary"
              style={{ padding: "14px", width: "50px" }}
            >
              <Settings size={18} />
            </button>

            {/* Dropdown Options */}
            {isDropdownOpen && (
              <div className="glass-panel" style={{
                position: "absolute",
                bottom: "60px",
                right: "40px",
                zIndex: "50",
                width: "260px",
                padding: "8px",
                border: "1px solid var(--border-glass)",
                textAlign: "left"
              }}>
                <button
                  onClick={() => {
                    setIsDropdownOpen(false);
                    startMeeting("restricted");
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: "transparent",
                    border: "none",
                    color: "white",
                    cursor: "pointer",
                    textAlign: "left",
                    borderRadius: "6px",
                    fontSize: "0.9rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    transition: "var(--transition-smooth)"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <Plus size={16} color="var(--primary)" />
                  <div>
                    <div style={{ fontWeight: "600" }}>Restricted Meeting</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Requires host manual approval</div>
                  </div>
                </button>
              </div>
            )}
          </div>

        </div>
      </main>

    </div>
  );
};

export default Home;
