import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, doc, onSnapshot, collection, query, orderBy, limit, 
    addDoc, serverTimestamp, updateDoc, where, getDocs, increment 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- Firebase Configuration ---
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

let currentUser = null;
let currentUserData = null;

// --- تحسين دالة إظهار الخطأ ---
function showError(msg) {
    Swal.fire({
        icon: 'error',
        title: 'NOTIFICATION',
        text: msg,
        background: '#0a0f1d',
        color: '#fff',
        confirmButtonColor: '#3b82f6',
        backdrop: `rgba(0,0,0,0.85)`,
        position: 'center',
        customClass: {
            popup: 'rounded-[2rem] border border-white/10 shadow-2xl',
            confirmButton: 'rounded-xl px-10 py-2 font-black uppercase text-xs'
        }
    });
}

// --- 1. مراقبة حالة المستخدم والبيانات (مزامنة فورية) ---
onAuthStateChanged(auth, user => {
    if (user) {
        currentUser = user;
        onSnapshot(doc(db, "users", user.uid), (snap) => {
            currentUserData = snap.data();
            if (currentUserData) {
                document.getElementById('userBalance').innerText = `$${parseFloat(currentUserData.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
                document.getElementById('userName').innerText = currentUserData.fullName || "User";
                document.getElementById('userTier').innerText = currentUserData.tier || "Tier 1";
                
                // التأكد من تفعيل واجهة الإيداع إذا وُجد العنوان
                if (currentUserData.depositAddress) {
                    enableAddressUI(currentUserData.depositAddress);
                }
            }
        });
        loadTransactions(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

// --- 2. فتح لوحة السحب ---
document.getElementById('withdrawTrigger').onclick = () => {
    if (!currentUserData?.securePin) {
        return Swal.fire({
            icon: 'lock',
            title: 'Security Pin Required',
            text: 'Please set your 6-digit Secure PIN in Profile first.',
            background: '#0a0f1d', color: '#fff',
            confirmButtonText: 'Go to Profile',
            showCancelButton: true
        }).then(res => { if(res.isConfirmed) window.location.href = 'profile.html'; });
    }
    document.getElementById('withdrawAvailableBalance').innerText = `Available: $${parseFloat(currentUserData.balance || 0).toFixed(2)}`;
    document.getElementById('withdrawPanel').classList.add('show-panel');
};

// --- 3. تنفيذ عملية السحب ---
document.getElementById('submitWithdrawBtn').onclick = async () => {
    const btn = document.getElementById('submitWithdrawBtn');
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const address = document.getElementById('withdrawAddress').value;
    const enteredPin = document.getElementById('vaultPin').value;

    if (!address || isNaN(amount) || enteredPin.length !== 6) return showError("Please fill all fields correctly.");
    if (enteredPin !== currentUserData.securePin) return showError("Incorrect Security PIN.");
    if (amount < 10) return showError("Minimum withdrawal is $10.00");
    if (amount > (currentUserData.balance || 0)) return showError("Insufficient balance in your vault.");

    try {
        btn.disabled = true;
        btn.innerText = "Verifying...";

        const q = query(collection(db, "withdrawals"), where("uid", "==", currentUser.uid), where("status", "==", "pending"));
        const snap = await getDocs(q);
        if (!snap.empty) {
            btn.disabled = false;
            btn.innerText = "Initiate Payout";
            return showError("You already have an active pending request.");
        }

        await updateDoc(doc(db, "users", currentUser.uid), { balance: increment(-amount) });

        const withdrawData = {
            uid: currentUser.uid,
            email: currentUser.email || "No Email",
            fullName: currentUserData.fullName || "User",
            amount: amount,
            address: address,
            status: "pending",
            type: "Withdrawal",
            timestamp: serverTimestamp()
        };

        const docRef = await addDoc(collection(db, "withdrawals"), withdrawData);
        
        await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
            ...withdrawData,
            mainId: docRef.id 
        });

        Swal.fire({ 
            icon: 'success', 
            title: 'REQUEST SENT', 
            text: 'Your funds are locked. Admin audit in progress.', 
            background: '#0a0f1d', color: '#fff',
            confirmButtonColor: '#3b82f6'
        });

        document.getElementById('withdrawPanel').classList.remove('show-panel');
        document.getElementById('vaultPin').value = "";
        document.getElementById('withdrawAmount').value = "";

    } catch (e) {
        showError("System busy. Please try again later.");
    } finally {
        btn.disabled = false;
        btn.innerText = "Initiate Payout";
    }
};

// --- 4. تحديث سجل المعاملات (onSnapshot) ---
function loadTransactions(uid) {
    const q = query(collection(db, "users", uid, "transactions"), orderBy("timestamp", "desc"), limit(10));
    onSnapshot(q, (snap) => {
        const cont = document.getElementById('transactionHistory');
        cont.innerHTML = ""; 
        
        if (snap.empty) {
            cont.innerHTML = '<p class="text-center text-[10px] py-10 opacity-30 italic">No recent activity</p>';
            return;
        }

        snap.forEach(d => {
            const tx = d.data();
            let statusColor = "text-amber-500"; 
            if (tx.status === 'approved') statusColor = "text-emerald-500";
            if (tx.status === 'rejected') statusColor = "text-red-500";

            cont.innerHTML += `
                <div class="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
                    <div>
                        <span class="text-[10px] font-black uppercase text-slate-400">${tx.type}</span>
                        <p class="text-[8px] text-slate-600 font-mono">${tx.timestamp ? new Date(tx.timestamp.toDate()).toLocaleString() : 'Processing...'}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-xs font-black italic text-white">$${parseFloat(tx.amount).toFixed(2)}</p>
                        <p class="text-[8px] font-black uppercase ${statusColor}">${tx.status}</p>
                    </div>
                </div>`;
        });
    });
}

// --- وظائف الإيداع الأوتوماتيكي والنسخ ---
function enableAddressUI(addr) {
    document.getElementById('depositAddrText').innerText = addr;
    
    // توليد QR Code تلقائياً في القسم المخصص له
    const qrContainer = document.getElementById('qrcode');
    if (qrContainer) {
        qrContainer.innerHTML = ""; // تنظيف الكود القديم
        new QRCode(qrContainer, {
            text: addr,
            width: 128,
            height: 128,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    }
}

document.getElementById('closeWithdraw').onclick = () => document.getElementById('withdrawPanel').classList.remove('show-panel');

document.getElementById('copyBtn').onclick = () => {
    const addr = document.getElementById('depositAddrText').innerText;
    if (addr === "Generating...") return;
    
    navigator.clipboard.writeText(addr);
    Swal.fire({ 
        icon: 'success', 
        title: 'Address Copied', 
        toast: true, 
        position: 'top', 
        showConfirmButton: false, 
        timer: 1500,
        background: '#0a0f1d',
        color: '#fff'
    });
};
