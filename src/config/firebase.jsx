import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCdc49g9F-WHs2XogTumcWAV3Mcn6zWa0s",
  authDomain: "sas-react-app.firebaseapp.com",
  projectId: "sas-react-app",
  storageBucket: "sas-react-app.firebasestorage.app",
  messagingSenderId: "599404397870",
  appId: "1:599404397870:web:fa1f7ca2da89b87306a6bf",
  measurementId: "G-JYXC6B69Y7"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Explicit persistence — keeps the signed-in session across reloads but tied
// to the device. Combined with the idle-timeout hook in App.jsx, abandoned
// sessions are signed out after 30 minutes of inactivity.
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Firebase setPersistence failed:", err?.message || err);
});

export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);