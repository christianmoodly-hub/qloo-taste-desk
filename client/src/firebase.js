import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB2nF0-Ap5RVrHdguqIZzfI7a_Btj3n1oI",
  authDomain: "qloproject.firebaseapp.com",
  projectId: "qloproject",
  storageBucket: "qloproject.firebasestorage.app",
  messagingSenderId: "838742612778",
  appId: "1:838742612778:web:a8d8c0549592d1b3401c53",
  measurementId: "G-3XTF7Y7L9H",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

function deskRef(uid) {
  return doc(db, "desks", uid);
}

export async function loadCloudDesk(uid) {
  const snapshot = await getDoc(deskRef(uid));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveCloudDesk(uid, desk) {
  await setDoc(deskRef(uid), {
    favorites: desk.favorites,
    target: desk.target,
    city: desk.city,
    mode: desk.mode,
    qlooPlan: desk.qlooPlan ?? null,
    plainPlan: desk.plainPlan ?? null,
    updatedAt: serverTimestamp(),
  });
}

isSupported()
  .then((supported) => {
    if (supported) getAnalytics(firebaseApp);
  })
  .catch(() => {});
