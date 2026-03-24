import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, doc, onSnapshot, collection, query, orderBy, limit, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAmlAKs35FG4hbcaPkVQ_s0FSaZsvWzFak",
    authDomain: "cloud-mining-6f190.firebaseapp.com",
    projectId: "cloud-mining-6f190",
    storageBucket: "cloud-mining-6f190.firebasestorage.app",
    messagingSenderId: "144227180849",
    appId: "1:144227180849:web:ccbda447d074efbbddd010"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Variables
let currentAddr = "";
let qrGenerated = false;
let currentUser = null;
let currentUserData = null;

// Selectors
const copyBtn = document.getElementById('copyBtn');
const depositAddrText = document.getElementById('depositAddrText');
const depositPanel = document.getElementById('depositPanel');
const depositTrigger = document.getElementById('depositTrigger');
const closeDep = document.getElementById('closeDep');
const withdrawTrigger = document.getElementById('withdrawTrigger');
const withdrawPanel = document.getElementById('withdrawPanel');
const closeWithdraw = document.getElementById('closeWithdraw');

// Formatting
const formatCurrency = (amount) => `$${parseFloat(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Sync User Data
onAuthStateChanged(auth, user => {
    if (user) {
        currentUser = user;
        onSnapshot(doc(db, "users", user.uid), (snap) => {
            const data = snap.data();
            if (data) {
                currentUserData = data;
                document.getElementById('userBalance').innerText = formatCurrency(data.balance || 0);
                document.getElementById('userName').innerText = data.fullName || "USER";
                document.getElementById('userTier').innerText = data.tier || "Tier 1";
                // Update deposit address if available
                if (data.depositAddress) enableAddressUI(data.depositAddress);
            }
        });
        loadTransactions(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

function enableAddressUI(address) {
    currentAddr = address;
    depositAddrText.innerText = address;
    copyBtn.disabled = false;
    copyBtn.classList.remove('copy-disabled');
    copyBtn.classList.add('copy-ready');

    if (!qrGenerated) {
        document.getElementById("qrcode").innerHTML = "";
        new QRCode(document.getElementById("qrcode"), { text: address, width: 160, height: 160 });
        qrGenerated = true;
    }
}

function loadTransactions(uid) {
    const q = query(collection(db, "users", uid, "transactions"), orderBy("timestamp", "desc"), limit(10));
    onSnapshot(q, (snapshot) => {
        const historyCont = document.getElementById('transactionHistory');
        historyCont.innerHTML = snapshot.empty ? '<p class="text-center text-[10px] text-slate-500 py-4">NO TRANSACTIONS</p>' : '';
        // ... (هنا يتم إضافة كود بناء عناصر القائمة بنفس الستايل الأصلي)
    });
}

// UI Events
depositTrigger.onclick = () => depositPanel.classList.add('show-panel');
closeDep.onclick = () => depositPanel.classList.remove('show-panel');
withdrawTrigger.onclick = () => {
    document.getElementById('withdrawAvailableBalance').innerText = formatCurrency(currentUserData?.balance || 0);
    withdrawPanel.classList.add('show-panel');
};
closeWithdraw.onclick = () => withdrawPanel.classList.remove('show-panel');

copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(currentAddr);
    Swal.fire({ title: 'Copied!', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
};
