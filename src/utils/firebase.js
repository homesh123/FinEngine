import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "firebase/firestore";

// Your web app's Firebase configuration
// We will use environment variables for security.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "fxcharts-af62f.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "fxcharts-af62f",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "fxcharts-af62f.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "208368037340",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export const loginWithGoogle = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        return result.user;
    } catch (error) {
        console.error("Error signing in with Google", error);
        throw error;
    }
};

export const logout = async () => {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Error signing out", error);
        throw error;
    }
};

// Listen to auth state
export const subscribeToAuth = (callback) => {
    return onAuthStateChanged(auth, callback);
};

// Sync State functions
export const saveUserSettings = async (userId, settings) => {
    if (!userId) return;
    try {
        await setDoc(doc(db, "users", userId), {
            settings,
            lastUpdated: new Date().toISOString()
        }, { merge: true });
    } catch (error) {
        console.error("Error saving user settings", error);
    }
};

export const getUserSettings = async (userId) => {
    if (!userId) return null;
    try {
        const docRef = doc(db, "users", userId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data().settings;
        }
    } catch (error) {
        console.error("Error fetching user settings", error);
    }
    return null;
};

export { auth, db };
