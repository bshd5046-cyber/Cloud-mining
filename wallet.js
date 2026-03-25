import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, doc, onSnapshot, collection, query, orderBy, limit, 
    addDoc, serverTimestamp, getDoc, where, getDocs, setDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- إعدادات Firebase ---
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

// --- متغيرات الحالة ---
let currentUser = null;
let currentUserData = null;
let qrGenerated = false;

const TIER_LIMITS = {
    "Tier 1": 500, "Tier 2": 2000, "Tier 3": 5000, "Tier 4": 8000, "Tier 5": 10000
};

// --- اختيار العناصر ---
const withdrawTrigger = document.getElementById('withdrawTrigger');
const withdrawPanel = document.getElementById('withdrawPanel');
const submitWithdrawBtn = document.getElementById('submitWithdrawBtn');
const withdrawAmountInput = document.getElementById('withdrawAmount');
const vaultPinInput = document.getElementById('vaultPin');

const formatCurrency = (amount) => `$${parseFloat(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// --- مراقبة حالة المستخدم ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        // تحديث بيانات الجلسة للتأكد من حالة الإيميل
        await user.reload(); 

        onSnapshot(doc(db, "users", user.uid), (snap) => {
            const data = snap.data();
            if (data) {
                currentUserData = data;
                updateUI(data);
            }
        });
        loadTransactions(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

// تحديث الواجهة
function updateUI(data) {
    document.getElementById('userBalance').innerText = formatCurrency(data.balance || 0);
    document.getElementById('userName').innerText = data.fullName || "GUEST";
    const tier = data.tier || "Tier 1";
    document.getElementById('userTier').innerText = tier;
    
    if(document.getElementById('displayTier')) document.getElementById('displayTier').innerText = `${tier} Status`;
    if(document.getElementById('displayLimit')) document.getElementById('displayLimit').innerText = `LIMIT: ${formatCurrency(TIER_LIMITS[tier])}`;
    
    if (data.depositAddress) enableAddressUI(data.depositAddress);
}

// --- فتح لوحة السحب مع فحص الإيميل ---
withdrawTrigger.onclick = async () => {
    // تحديث الحالة للتأكد من تأكيد الإيميل
    await auth.currentUser.reload();
    
    if (!auth.currentUser.emailVerified) {
        Swal.fire({
            title: 'Verify Your Email',
            text: 'Security Protocol: You must verify your email address before making a withdrawal.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Send Verification Link',
            background: '#070b16', color: '#fff', confirmButtonColor: '#3b82f6'
        }).then((result) => {
            if (result.isConfirmed) {
                sendEmailVerification(auth.currentUser).then(() => {
                    Swal.fire('Link Sent', 'Please check your inbox and spam folder.', 'success');
                });
            }
        });
        return;
    }

    document.getElementById('withdrawAvailableBalance').innerText = formatCurrency(currentUserData?.balance || 0);
    withdrawPanel.classList.add('show-panel');
};

// --- معالجة طلب السحب النهائي ---
submitWithdrawBtn.onclick = async () => {
    const amount = parseFloat(withdrawAmountInput.value);
    const address = document.getElementById('withdrawAddress').value;
    const network = document.getElementById('withdrawNetwork').value;
    const enteredPin = vaultPinInput.value;
    const userTier = currentUserData?.tier || "Tier 1";
    const maxLimit = TIER_LIMITS[userTier] || 500;

    // 1. الفحوصات الأمنية الأساسية
    if (!address || isNaN(amount) || !enteredPin) {
        return showError("All fields including Security PIN are required.");
    }

    if (enteredPin !== currentUserData?.withdrawalPin) {
        return showError("Security Vault PIN is incorrect.");
    }

    if (amount < 10) return showError("Minimum withdrawal is $10.00");
    if (amount > maxLimit) return showError(`Limit Exceeded for ${userTier}`);
    if (amount > (currentUserData?.balance || 0)) return showError("Insufficient funds.");

    try {
        submitWithdrawBtn.disabled = true;
        submitWithdrawBtn.innerText = "Authorizing...";

        // --- الفحص: هل يوجد طلب معلق؟ ---
        const withdrawalsRef = collection(db, "withdrawals");
        const q = query(withdrawalsRef, 
            where("uid", "==", currentUser.uid), 
            where("status", "==", "pending")
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            showError("Active Protocol: You already have a pending withdrawal request.");
            return;
        }

        const withdrawData = {
            uid: currentUser.uid,
            email: currentUser.email,
            fullName: currentUserData.fullName,
            amount: amount,
            fee: amount * 0.05,
            netAmount: amount * 0.95,
            address: address,
            network: network,
            status: "pending",
            timestamp: serverTimestamp(),
            tierAtTime: userTier,
            securityCleared: true
        };

        // تسجيل الطلب
        const docRef = await addDoc(collection(db, "withdrawals"), withdrawData);
        await setDoc(doc(db, "users", currentUser.uid, "withdrawals", docRef.id), withdrawData);

        // تسجيل في السجل المالي للمستخدم
        await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
            type: "Withdrawal",
            amount: amount,
            status: "pending",
            timestamp: serverTimestamp(),
            details: `Net: ${formatCurrency(amount * 0.95)} | Network: ${network}`
        });

        Swal.fire({
            title: 'Withdrawal Initiated',
            text: 'Your request has been placed in the queue for manual audit (2-120h).',
            icon: 'success',
            background: '#070b16', color: '#fff', confirmButtonColor: '#3b82f6'
        });

        withdrawPanel.classList.remove('show-panel');
        clearInputs();
        
    } catch (error) {
        showError("Blockchain relay error. Please try again.");
    } finally {
        submitWithdrawBtn.disabled = false;
        submitWithdrawBtn.innerText = "Initiate Payout";
    }
};

// وظائف مساعدة
function clearInputs() {
    withdrawAmountInput.value = "";
    vaultPinInput.value = "";
    document.getElementById('withdrawAddress').value = "";
}

function enableAddressUI(address) {
    document.getElementById('depositAddrText').innerText = address;
    if (!qrGenerated) {
        document.getElementById("qrcode").innerHTML = "";
        new QRCode(document.getElementById("qrcode"), { text: address, width: 180, height: 180 });
        qrGenerated = true;
    }
}

function loadTransactions(uid) {
    const q = query(collection(db, "users", uid, "transactions"), orderBy("timestamp", "desc"), limit(15));
    onSnapshot(q, (snapshot) => {
        const historyCont = document.getElementById('transactionHistory');
        historyCont.innerHTML = "";
        if (snapshot.empty) {
            historyCont.innerHTML = '<p class="text-center text-[10px] text-slate-500 py-10 italic">No activity detected.</p>';
            return;
        }
        snapshot.forEach(doc => {
            const tx = doc.data();
            const date = tx.timestamp?.toDate().toLocaleString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'}) || "Pending";
            const statusClass = tx.status === 'pending' ? 'text-amber-500' : (tx.status === 'approved' ? 'text-emerald-500' : 'text-rose-500');
            historyCont.innerHTML += `
                <div class="p-4 flex justify-between items-center border-b border-white/5">
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 rounded-full flex items-center justify-center ${tx.type === 'Withdrawal' ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'}">
                            <i class="fas ${tx.type === 'Withdrawal' ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                        </div>
                        <div>
                            <p class="text-[11px] font-black uppercase">${tx.type}</p>
                            <p class="text-[9px] text-slate-500">${date}</p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-sm font-black text-slate-100">${formatCurrency(tx.amount)}</p>
                        <p class="text-[8px] font-black uppercase ${statusClass}">${tx.status}</p>
                    </div>
                </div>`;
        });
    });
}

function showError(msg) {
    Swal.fire({ icon: 'error', title: 'Action Denied', text: msg, background: '#070b16', color: '#fff', confirmButtonColor: '#ef4444' });
}

// أحداث الإغلاق والفتح
document.getElementById('depositTrigger').onclick = () => document.getElementById('depositPanel').classList.add('show-panel');
document.getElementById('closeDep').onclick = () => document.getElementById('depositPanel').classList.remove('show-panel');
document.getElementById('closeWithdraw').onclick = () => document.getElementById('withdrawPanel').classList.remove('show-panel');
document.getElementById('copyBtn').onclick = async () => {
    const addr = document.getElementById('depositAddrText').innerText;
    await navigator.clipboard.writeText(addr);
    Swal.fire({ title: 'Copied', icon: 'success', toast: true, position: 'top', showConfirmButton: false, timer: 1500 });
};
