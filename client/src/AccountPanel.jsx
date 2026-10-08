import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { auth } from "./firebase.js";

function authError(error) {
  switch (error?.code) {
    case "auth/email-already-in-use":
      return "That email already has an account. Sign in instead.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
      return "Use a password of at least 6 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password do not match an account.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute and try again.";
    case "auth/operation-not-allowed":
      return "Email sign-in is not enabled for this Firebase project yet.";
    default:
      return "The account request did not go through. Try again.";
  }
}

export function AccountPanel({ user, id = "account", onSession }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      if (creating) {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const displayName = name.trim();
        if (displayName) {
          await updateProfile(credential.user, { displayName });
          onSession?.();
        }
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      setPassword("");
    } catch (failure) {
      setError(authError(failure));
    } finally {
      setPending(false);
    }
  }

  if (user) {
    const label = user.displayName || user.email;
    return (
      <section className="account-card" id={id}>
        <p className="step-kicker">Your account</p>
        <h2>{label}</h2>
        <p className="interview-help">This sign-in keeps your tastes in your account.</p>
        <button type="button" className="nav-back" onClick={() => signOut(auth)}>Sign out</button>
      </section>
    );
  }

  return (
    <section className="account-card" id={id}>
      <p className="step-kicker">{creating ? "Create account" : "Sign in"}</p>
      <h2>{creating ? "Keep this desk under your name." : "Welcome back."}</h2>
      <p className="interview-help">Email and a password. Each account keeps its own tastes.</p>
      <form className="account-form" onSubmit={onSubmit}>
        {creating ? (
          <label>
            Name
            <input value={name} autoComplete="name" onChange={(event) => setName(event.target.value)} />
          </label>
        ) : null}
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            minLength={6}
            autoComplete={creating ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="account-actions">
          <button type="submit" className="cta" disabled={pending}>
            {pending ? "Checking" : creating ? "Create account" : "Sign in"}
          </button>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setCreating((value) => !value);
              setError("");
            }}
          >
            {creating ? "I already have an account" : "Create an account"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function accountInitials(user) {
  const source = user?.displayName || user?.email || "";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
  return letters || "·";
}
