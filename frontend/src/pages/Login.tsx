import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../App";
import { Video, Lock, Mail, AlertCircle, ArrowRight } from "lucide-react";

const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Redirect target after login (e.g. from joining a restricted meeting)
  const from = location.state?.from?.pathname || "/";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Failed to login. Please check credentials.");
      }

      const data = await res.json();
      login(data.token, data.user);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-center" style={{ minHeight: "100vh", padding: "20px" }}>
      <div className="glass-panel" style={{ width: "100%", maxWidth: "440px", padding: "40px 30px" }}>
        
        {/* Logo and Brand */}
        <div style={{ textAlign: "center", marginBottom: "35px" }}>
          <div className="flex-center hover-scale" style={{
            width: "60px",
            height: "60px",
            background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
            borderRadius: "16px",
            margin: "0 auto 16px",
            boxShadow: "0 8px 24px rgba(99, 102, 241, 0.4)"
          }}>
            <Video size={30} color="white" />
          </div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.85rem", fontWeight: "700", letterSpacing: "-0.02em" }}>
            Converse Meet
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "6px" }}>
            Simple, high-quality video conferencing
          </p>
        </div>

        {error && (
          <div className="flex-center" style={{
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.25)",
            borderRadius: "10px",
            padding: "12px",
            color: "#f87171",
            fontSize: "0.88rem",
            gap: "8px",
            marginBottom: "24px"
          }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div style={{ position: "relative" }}>
              <Mail size={18} color="var(--text-muted)" style={{ position: "absolute", left: "14px", top: "16px" }} />
              <input
                type="email"
                className="form-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: "100%", paddingLeft: "42px" }}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div style={{ position: "relative" }}>
              <Lock size={18} color="var(--text-muted)" style={{ position: "absolute", left: "14px", top: "16px" }} />
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: "100%", paddingLeft: "42px" }}
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: "100%", padding: "14px", marginTop: "8px" }}>
            {loading ? "Signing in..." : (
              <>
                <span>Sign In</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: "24px", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
          Don't have an account?{" "}
          <Link to="/register" style={{ color: "var(--primary)", fontWeight: "600", textDecoration: "none" }}>
            Create one
          </Link>
        </div>

      </div>
    </div>
  );
};

export default Login;
