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

// --- دالة إظهار الخطأ بشكل iOS الاحترافي ---
function showError(msg) {
    Swal.fire({
        icon: 'error',
        title: 'ACTION DENIED',
        text: msg,
        background: '#070b16',
        color: '#fff',
        confirmButtonColor: '#3b82f6',
        customClass: {
            popup: 'ios-alert',
            confirmButton: 'ios-btn'
        }
    });
}

// --- 1. مراقبة حالة المستخدم وتحديث البيانات ---
onAuthStateChanged(auth, user => {
    if (user) {
        currentUser = user;
        onSnapshot(doc(db, "users", user.uid), (snap) => {
            currentUserData = snap.data();
            if (currentUserData) {
                // تحديث الرصيد والاسم والـ Tier في الواجهة
                document.getElementById('userBalance').innerText = `$${parseFloat(currentUserData.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
                document.getElementById('userName').innerText = currentUserData.fullName || "User";
                document.getElementById('userTier').innerText = currentUserData.tier || "Tier 1";
                if (currentUserData.depositAddress) enableAddressUI(currentUserData.depositAddress);
            }
        });
        loadTransactions(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

// --- 2. فتح لوحة السحب (الفحص بناءً على securePin) ---
document.getElementById('withdrawTrigger').onclick = () => {
    // التحقق من الاسم الصحيح للحقل كما في الصورة securePin
    if (!currentUserData?.securePin || currentUserData.securePin === "") {
        return Swal.fire({
            icon: 'lock',
            title: 'Security Required',
            text: 'Please set your 6-digit Secure PIN in Profile settings first.',
            showCancelButton: true,
            confirmButtonText: 'Go to Profile',
            background: '#070b16', color: '#fff',
            customClass: { popup: 'ios-alert', confirmButton: 'ios-btn' }
        }).then(res => { if(res.isConfirmed) window.location.href = 'profile.html'; });
    }
    
    document.getElementById('withdrawAvailableBalance').innerText = `Available: $${parseFloat(currentUserData.balance || 0).toFixed(2)}`;
    document.getElementById('withdrawPanel').classList.add('show-panel');
};

// --- 3. تنفيذ عملية السحب (الخصم + الإرسال للآدمن) ---
document.getElementById('submitWithdrawBtn').onclick = async () => {
    const btn = document.getElementById('submitWithdrawBtn');
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const address = document.getElementById('withdrawAddress').value;
    const enteredPin = document.getElementById('vaultPin').value;

    // فحوصات الأمان
    if (!address || isNaN(amount) || enteredPin.length !== 6) return showError("Complete all fields correctly.");
    if (enteredPin !== currentUserData.securePin) return showError("Incorrect Security PIN.");
    if (amount < 10) return showError("Minimum withdrawal is $10.00");
    if (amount > (currentUserData.balance || 0)) return showError("Insufficient Vault Balance.");

    try {
        btn.disabled = true;
        btn.innerText = "Authorizing...";

        // أ. فحص إذا كان هناك طلب معلق لتجنب التكرار
        const q = query(collection(db, "withdrawals"), where("uid", "==", currentUser.uid), where("status", "==", "pending"));
        const snap = await getDocs(q);
        if (!snap.empty) {
            btn.disabled = false;
            btn.innerText = "Initiate Payout";
            return showError("You already have an active pending request.");
        }

        // ب. خصم الرصيد فوراً من حساب المستخدم
        await updateDoc(doc(db, "users", currentUser.uid), { balance: increment(-amount) });

        // ج. إنشاء طلب السحب في المجموعة العامة (للآدمن)
        const withdrawData = {
            uid: currentUser.uid,
            email: currentUser.email,
            fullName: currentUserData.fullName,
            amount: amount,
            netAmount: amount * 0.95, // عمولة 5%
            address: address,
            status: "pending",
            timestamp: serverTimestamp(),
            type: "Withdrawal"
        };
        await addDoc(collection(db, "withdrawals"), withdrawData);
        
        // د. تسجيل المعاملة في سجل المستخدم الخاص
        await addDoc(collection(db, "users", currentUser.uid, "transactions"), withdrawData);

        Swal.fire({ 
            icon: 'success', 
            title: 'Success', 
            text: 'Funds locked. Payout pending audit.', 
            background: '#070b16', color: '#fff' 
        });

        document.getElementById('withdrawPanel').classList.remove('show-panel');
        document.getElementById('vaultPin').value = "";
        document.getElementById('withdrawAmount').value = "";
    } catch (e) {
        showError("Blockchain relay error. Please try again.");
    } finally {
        btn.disabled = false;
        btn.innerText = "Initiate Payout";
    }
};

// --- 4. نظام الإيداع (تأكيد الدفع) ---
if (document.getElementById('submitDeposit')) {
    document.getElementById('submitDeposit').onclick = async () => {
        const hash = document.getElementById('txHash').value;
        if (!hash) return showError("Please enter Transaction Hash/ID.");

        await addDoc(collection(db, "deposits"), {
            uid: currentUser.uid,
            email: currentUser.email,
            hash: hash,
            status: "pending",
            timestamp: serverTimestamp()
        });
        
        Swal.fire({ icon: 'success', title: 'Sent', text: 'Admin is verifying your deposit.', background: '#070b16', color: '#fff' });
        document.getElementById('txHash').value = "";
        document.getElementById('depositPanel').classList.remove('show-panel');
    };
}

// --- وظائف مساعدة ---
function loadTransactions(uid) {
    const q = query(collection(db, "users", uid, "transactions"), orderBy("timestamp", "desc"), limit(10));
    onSnapshot(q, (snap) => {
        const cont = document.getElementById('transactionHistory');
        cont.innerHTML = snap.empty ? '<p class="text-center text-[10px] py-10 opacity-30 italic">No activity</p>' : "";
        snap.forEach(d => {
            const tx = d.data();
            const color = tx.status === 'pending' ? 'text-amber-500' : 'text-emerald-500';
            cont.innerHTML += `
                <div class="p-4 border-b border-white/5 flex justify-between items-center">
                    <span class="text-[10px] font-black uppercase text-slate-400">${tx.type}</span>
                    <div class="text-right">
                        <p class="text-xs font-black italic">$${parseFloat(tx.amount).toFixed(2)}</p>
                        <p class="text-[8px] font-black uppercase ${color}">${tx.status}</p>
                    </div>
                </div>`;
        });
    });
}

function enableAddressUI(addr) {
    document.getElementById('depositAddrText').innerText = addr;
    const qrBox = document.getElementById('qrcode');
    if (qrBox && qrBox.innerHTML === "") {
        new QRCode(qrBox, { text: addr, width: 140, height: 140, colorDark: "#000000", colorLight: "#ffffff" });
    }
}

// أزرار الإغلاق والنسخ
document.getElementById('closeDep').onclick = () => document.getElementById('depositPanel').classList.remove('show-panel');
document.getElementById('closeWithdraw').onclick = () => document.getElementById('withdrawPanel').classList.remove('show-panel');
document.getElementById('copyBtn').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('depositAddrText').innerText);
    Swal.fire({ icon: 'success', title: 'Copied', toast: true, position: 'top', showConfirmButton: false, timer: 1500 });
};
