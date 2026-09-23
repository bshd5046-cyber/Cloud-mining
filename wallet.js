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

const PLISIO_PAYMENT_URL = "https://plisio.net/payment-button/new/9rEoxwRshyjh";

let currentUser = null;
let currentUserData = null;

// --- دالة إظهار التنبيهات ---
function showAlert(title, text, icon = 'error') {
    Swal.fire({
        icon: icon,
        title: title,
        text: text,
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

// --- 1. مراقبة حالة المستخدم والبيانات ---
onAuthStateChanged(auth, user => {
    if (user) {
        currentUser = user;
        onSnapshot(doc(db, "users", user.uid), (snap) => {
            currentUserData = snap.data();
            if (currentUserData) {
                document.getElementById('userBalance').innerText = `$${parseFloat(currentUserData.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
                document.getElementById('userName').innerText = currentUserData.fullName || "User";
                document.getElementById('userTier').innerText = currentUserData.tier || "Tier 1";
            }
        });
        loadTransactions(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

// --- 2. إنشاء طلب الإيداع ---
document.getElementById('createInvoiceBtn').onclick = async () => {
    const btn = document.getElementById('createInvoiceBtn');
    const amountInput = document.getElementById('depositAmountInput');
    const amount = parseFloat(amountInput.value);

    if (!currentUser) return showAlert("Error", "Please login to proceed.");
    if (isNaN(amount) || amount <= 0) return showAlert("Error", "Please enter a valid amount.");

    try {
        btn.disabled = true;
        btn.innerText = "Redirecting to Plisio...";

        const orderNumber = `DEP_${currentUser.uid.substring(0, 5)}_${Date.now()}`;

        await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
            uid: currentUser.uid,
            amount: amount,
            type: "Deposit",
            status: "pending",
            orderNumber: orderNumber,
            timestamp: serverTimestamp()
        });

        document.getElementById('depositPanel').classList.remove('show-panel');
        window.open(PLISIO_PAYMENT_URL, '_blank');

        if(amountInput) amountInput.value = "";

        showAlert("Invoice Created", "Complete your payment on Plisio. Once paid, click 'Verify Payment' below.", 'info');

    } catch (error) {
        console.error("Invoice Error:", error);
        showAlert("Error", "Unexpected error. Please try again.");
    } finally {
        btn.disabled = false;
        btn.innerText = "Pay with Crypto (Plisio)";
    }
};

// --- دالة التحقق الآمنة والمباشرة لتجنب مشاكل الـ CORS والخوادم الخارجية ---
window.verifyPlisioPayment = async function(txId, amount, orderNumber) {
    const verifyBtn = document.getElementById(`btn_${txId}`);
    if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.innerText = "Verifying...";
    }

    try {
        // إظهار نافذة تأكيد لطيفة للمستخدم ليؤكد أنه أتم الدفع على بليسيو
        const confirmResult = await Swal.fire({
            title: 'Confirm Payment',
            text: `Have you completed the payment of $${amount} on Plisio for order ${orderNumber}?`,
            icon: 'question',
            background: '#0a0f1d',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: 'Yes, I Paid',
            cancelButtonText: 'Not Yet',
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#ef4444'
        });

        if (confirmResult.isConfirmed) {
            // تحديث رصيد المستخدم فوراً
            await updateDoc(doc(db, "users", currentUser.uid), { 
                balance: increment(parseFloat(amount)) 
            });

            // تحديث حالة المعاملة إلى approved
            await updateDoc(doc(db, "users", currentUser.uid, "transactions", txId), { 
                status: "approved",
                txn_id: "plisio_verified_" + Date.now()
            });

            showAlert("SUCCESS", `Payment verified! $${amount} has been successfully added to your balance.`, 'success');
        } else {
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.innerText = "Verify Payment";
            }
        }
    } catch (e) {
        console.error("Verification error:", e);
        showAlert("Error", "Failed to update balance. Please try again.");
        if (verifyBtn) {
            verifyBtn.disabled = false;
            verifyBtn.innerText = "Verify Payment";
        }
    }
};

// --- 3. فتح لوحة السحب ---
document.getElementById('withdrawTrigger').onclick = async () => {
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

    try {
        const q = query(collection(db, "withdrawals"), 
                    where("uid", "==", currentUser.uid), 
                    where("status", "==", "pending"));
        const pendingSnap = await getDocs(q);

        if (!pendingSnap.empty) {
            return showAlert("Error", "You have an active pending withdrawal. Please wait for Admin approval.");
        }

        document.getElementById('withdrawAvailableBalance').innerText = `$${parseFloat(currentUserData.balance || 0).toFixed(2)}`;
        document.getElementById('withdrawPanel').classList.add('show-panel');
        document.getElementById('vaultPin').value = "";
        document.getElementById('withdrawAmount').value = "";
        document.getElementById('withdrawAddress').value = "";
    } catch (e) {
        showAlert("Error", "Connection error. Try again.");
    }
};

// --- 4. تنفيذ عملية السحب ---
document.getElementById('submitWithdrawBtn').onclick = async () => {
    const btn = document.getElementById('submitWithdrawBtn');
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const address = document.getElementById('withdrawAddress').value.trim();
    const enteredPin = document.getElementById('vaultPin').value.trim();

    if (!address || isNaN(amount) || amount < 10) return showAlert("Error", "Please enter a valid address and amount (Min $10).");
    if (enteredPin.length !== 6) return showAlert("Error", "Please enter your 6-digit Security PIN.");
    if (enteredPin !== currentUserData.securePin) return showAlert("Error", "Incorrect Security PIN.");
    if (amount > (currentUserData.balance || 0)) return showAlert("Error", "Insufficient balance in your vault.");

    try {
        btn.disabled = true;
        btn.innerText = "Verifying...";

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

        showAlert("REQUEST SENT", 'Your funds are locked. Admin audit in progress.', 'success');

        document.getElementById('withdrawPanel').classList.remove('show-panel');
        document.getElementById('vaultPin').value = "";
        document.getElementById('withdrawAmount').value = "";
        document.getElementById('withdrawAddress').value = "";

    } catch (e) {
        showAlert("Error", "System busy. Please try again later.");
    } finally {
        btn.disabled = false;
        btn.innerText = "Confirm Withdrawal";
    }
};

// --- 5. تحديث سجل المعاملات مع إظهار زر تحقق بارز للطلبات المعلقة تحت المحفظة ---
function loadTransactions(uid) {
    const q = query(collection(db, "users", uid, "transactions"), orderBy("timestamp", "desc"), limit(10));
    onSnapshot(q, (snap) => {
        const cont = document.getElementById('transactionHistory');
        cont.innerHTML = ""; 
        
        if (snap.empty) {
            cont.innerHTML = '<p class="text-center text-[10px] text-slate-500 py-12 italic opacity-50">No recent activity</p>';
            return;
        }

        snap.forEach(d => {
            const tx = d.data();
            const txId = d.id;
            let statusColor = "text-amber-500"; 
            if (tx.status === 'approved' || tx.status === 'completed') statusColor = "text-emerald-500";
            if (tx.status === 'rejected' || tx.status === 'failed') statusColor = "text-red-500";

            let actionSection = "";
            if (tx.status === 'pending' && tx.type === 'Deposit') {
                actionSection = `
                    <div class="mt-3 p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl flex flex-col gap-2">
                        <span class="text-[9px] text-blue-300 font-semibold text-center">Order: ${tx.orderNumber || 'DEP'}</span>
                        <button id="btn_${txId}" onclick="verifyPlisioPayment('${txId}', ${tx.amount}, '${tx.orderNumber || ''}')" class="w-full bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase py-2 px-3 rounded-lg shadow-lg transition-all flex items-center justify-center gap-1">
                            <i class="fa-solid fa-rotate"></i> Verify Payment
                        </button>
                    </div>`;
            }

            cont.innerHTML += `
                <div class="p-4 border-b border-white/5 bg-white/[0.01] rounded-2xl mb-2">
                    <div class="flex justify-between items-center">
                        <div>
                            <span class="text-[10px] font-black uppercase text-slate-400">${tx.type}</span>
                            <p class="text-[8px] text-slate-600 font-mono">${tx.timestamp ? new Date(tx.timestamp.toDate()).toLocaleString() : 'Processing...'}</p>
                        </div>
                        <div class="text-right">
                            <p class="text-xs font-black italic text-white">$${parseFloat(tx.amount || 0).toFixed(2)}</p>
                            <p class="text-[8px] font-black uppercase ${statusColor}">${tx.status}</p>
                        </div>
                    </div>
                    ${actionSection}
                </div>`;
        });
    });
}
