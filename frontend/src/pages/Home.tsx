import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { Video, Plus, Key, LogOut, ArrowRight, ShieldAlert, Sparkles } from "lucide-react";
import { getApiBase } from "../utils/api";

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
      const res = await fetch(`${getApiBase()}/api/meeting/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ meeting_type: meetingType }),
      });
      if (!res.ok) throw new Error("Failed to create meeting.");
      const data = await res.json();
      navigate(`/${data.meeting_code}`);
    } catch (err: any) {
      setError(err.message || "Could not start meeting.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-col">
      <header className="header">
        <div className="header-brand">
          <div className="header-brand-icon">
            <Video size={20} color="white" />
          </div>
          Converse
        </div>
        <div className="header-right">
          <div className="header-user">
            <img src={user?.avatar || ""} alt="" className="avatar" />
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{user?.full_name}</span>
          </div>
          <button onClick={logout} className="btn btn-secondary btn-sm">
            <LogOut size={15} />
            <span>Logout</span>
          </button>
        </div>
      </header>

      <main className="page" style={{ flex: 1 }}>
        <div className="card card-md">
          <div style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(99, 102, 241, 0.1)", color: "var(--primary)", borderRadius: "50%", margin: "0 auto 18px" }}>
            <Sparkles size={22} />
          </div>

          <h1 className="title-lg">Instant Meetings & P2P Video</h1>
          <p className="desc">
            Secure, premium browser-based video calls with crystal-clear audio, dynamic screensharing, raise hand queue, and real-time host validation rooms.
          </p>

          {error && (
            <div className="alert alert-error">
              <ShieldAlert size={17} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleJoin} className="join-form">
            <div className="form-input-wrap" style={{ flex: 1, maxWidth: 280 }}>
              <Key size={17} className="form-input-icon" />
              <input
                type="text"
                className="form-input"
                placeholder="abcd-efgh-ijkl"
                value={meetingCode}
                onChange={(e) => setMeetingCode(e.target.value)}
                style={{ paddingLeft: 40, textAlign: "left" }}
              />
            </div>
            <button type="submit" className="btn btn-secondary">
              <span>Join</span>
              <ArrowRight size={15} />
            </button>
          </form>

          <div className="divider"><span>or</span></div>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", position: "relative" }}>
            <button
              onClick={() => startMeeting("open")}
              disabled={loading}
              className="btn btn-primary"
              style={{ padding: "13px 26px", flex: 1, maxWidth: 230 }}
            >
              <Plus size={18} />
              <span>Start New Meeting</span>
            </button>

            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              disabled={loading}
              className="btn btn-secondary btn-icon"
            >
              <Plus size={18} style={{ transform: isDropdownOpen ? "rotate(45deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
            </button>

            {isDropdownOpen && (
              <div className="dropdown" style={{ bottom: 56, right: 36 }}>
                <button
                  onClick={() => { setIsDropdownOpen(false); startMeeting("restricted"); }}
                  className="dropdown-item"
                >
                  <Plus size={16} color="var(--primary)" />
                  <div>
                    <div style={{ fontWeight: 600 }}>Restricted Meeting</div>
                    <div className="dropdown-item-sub">Requires host manual approval</div>
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
