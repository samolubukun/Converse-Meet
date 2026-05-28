import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { Video, Lock, Mail, User, AlertCircle, ArrowRight } from "lucide-react";
import { getApiBase } from "../utils/api";

const Register: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!fullName || !email || !password) {
      setError("Please fill in all fields.");
      return;
    }
    if (password.length < 4) {
      setError("Password must be at least 4 characters long.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, full_name: fullName }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Failed to create account.");
      }
      const data = await res.json();
      login(data.token, data.user);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="card card-sm">
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div className="logo-icon">
            <Video size={28} color="white" />
          </div>
          <h2 className="title">Create Account</h2>
          <p className="subtitle">Get started with premium calling</p>
        </div>

        {error && (
          <div className="alert alert-error">
            <AlertCircle size={17} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="form">
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <div className="form-input-wrap">
              <User size={17} className="form-input-icon" />
              <input
                type="text"
                className="form-input"
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div className="form-input-wrap">
              <Mail size={17} className="form-input-icon" />
              <input
                type="email"
                className="form-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="form-input-wrap">
              <Lock size={17} className="form-input-icon" />
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={loading} style={{ marginTop: 6 }}>
            {loading ? "Creating..." : (
              <><span>Sign Up</span><ArrowRight size={17} /></>
            )}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 22, fontSize: "0.88rem", color: "var(--text-secondary)" }}>
          Already have an account?{" "}
          <Link to="/login" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
