// ── Google OAuth ─────────────────────────
async function loginWithGoogle() {
  const SB = 'https://ulyrhnpoiypuvaurlqqi.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVseXJobnBvaXlwdXZhdXJscXFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyOTE5NTYsImV4cCI6MjA4Nzg2Nzk1Nn0.lU_Wi4G84X54BPdjhG_h-N4u2_HSYiAF-12hekDnejk';

  // PKCE helpers
  function genVerifier() {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  async function genChallenge(v) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
    return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }

  const verifier = genVerifier();
  const challenge = await genChallenge(verifier);

  // Use localStorage so it survives the redirect
  localStorage.setItem('pr_pkce_verifier', verifier);

  const redirectTo = encodeURIComponent(window.location.origin + '/');
  window.location.href = SB + '/auth/v1/authorize?provider=google&redirect_to=' + redirectTo
    + '&code_challenge=' + challenge + '&code_challenge_method=S256';
}

// Handle Google OAuth callback (PKCE flow)
(function(){
  const SB   = 'https://ulyrhnpoiypuvaurlqqi.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVseXJobnBvaXlwdXZhdXJscXFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyOTE5NTYsImV4cCI6MjA4Nzg2Nzk1Nn0.lU_Wi4G84X54BPdjhG_h-N4u2_HSYiAF-12hekDnejk';

  const code = new URLSearchParams(window.location.search).get('code');
  if (!code) return;

  const verifier = localStorage.getItem('pr_pkce_verifier') || '';
  localStorage.removeItem('pr_pkce_verifier');

  fetch(SB + '/auth/v1/token?grant_type=pkce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (!data.access_token) {
      console.error('PKCE token exchange failed:', data);
      return;
    }
    // Get user info
    return fetch(SB + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + data.access_token, 'apikey': ANON }
    })
    .then(function(r) { return r.json(); })
    .then(function(user) {
      var nameParts = ((user.user_metadata && user.user_metadata.full_name) || user.email || '').split(' ');
      var profile = {
        first_name: nameParts[0] || '',
        last_name:  nameParts.slice(1).join(' ') || '',
        email:      user.email || '',
        auth_user_id: user.id || '',
        avatar_url: (user.user_metadata && user.user_metadata.avatar_url) || null
      };
      // saveAuthSession expects {access_token, refresh_token, user, profile}
      saveAuthSession({
        access_token:  data.access_token,
        refresh_token: data.refresh_token || '',
        user:          user,
        profile:       profile
      });
      window.history.replaceState({}, '', '/');
      setTimeout(function() {
        showToast('✅ Welcome ' + (profile.first_name || '') + '! Google se login ho gaye!', 'success');
        handlePostLogin();
        updateAccountBtn();
        uCart();
      }, 300);
    });
  })
  .catch(function(e) { console.error('Google login error:', e); });
})();

// ── Auth Modal ──────────────────────────────────────────────────
function openAuth() {
  document.getElementById('authModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(function(){ document.getElementById('auth-phone-num').focus(); }, 300);
}
function handlePostLogin() {
  try {
    var returnTo = localStorage.getItem('pr_return_to');
    if (returnTo === 'cart') {
      localStorage.removeItem('pr_return_to');
      // Fetch fresh profile (has saved_addresses) before opening cart
      callAuth('get_profile', {}, true).then(function(data) {
        if (data && data.profile) {
          _authProfile = data.profile;
          try { localStorage.setItem('pr_auth_profile', JSON.stringify(data.profile)); } catch(e) {}
        }
        var banner = document.getElementById('cart-login-banner');
        if (banner) banner.style.display = 'none';
        openCart();
        prefillDelivery();
        renderSavedAddresses();
        setTimeout(function(){ showToast('✅ Login ho gaye! Ab checkout karo 🎉'); }, 300);
      }).catch(function() {
        // Even if profile fetch fails, open cart
        var banner = document.getElementById('cart-login-banner');
        if (banner) banner.style.display = 'none';
        openCart();
        prefillDelivery();
        renderSavedAddresses();
      });
    }
  } catch(e) {}
}

function closeAuth() {
  document.getElementById('authModal').classList.remove('open');
  document.body.style.overflow = '';
}
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(function(t,i){ t.classList.toggle('active', (i===0&&tab==='phone')||(i===1&&tab==='email')); });
  document.querySelectorAll('.auth-panel').forEach(function(p){ p.classList.remove('active'); });
  document.getElementById('auth-' + tab).classList.add('active');
}
function showEmailSignup() {
  document.getElementById('auth-email-login').style.display = 'none';
  document.getElementById('auth-email-signup').style.display = 'block';
}
function showForgotPassword() {
  document.getElementById('auth-email-login').style.display   = 'none';
  document.getElementById('auth-email-signup').style.display  = 'none';
  document.getElementById('auth-forgot').style.display        = 'block';
  setTimeout(function(){ document.getElementById('auth-forgot-email').focus(); }, 100);
}
function showEmailLogin() {
  document.getElementById('auth-email-login').style.display   = 'block';
  document.getElementById('auth-email-signup').style.display  = 'none';
  document.getElementById('auth-forgot').style.display        = 'none';
}

// ── OTP Flow ────────────────────────────────────────────────────
var _otpCountdown = null;
function startOtpTimer() {
  var secs = 30;
  var timerEl = document.getElementById('otpTimer');
  clearInterval(_otpCountdown);
  _otpCountdown = setInterval(function() {
    secs--;
    if (timerEl) timerEl.textContent = 'Resend in ' + secs + 's';
    if (secs <= 0) {
      clearInterval(_otpCountdown);
      if (timerEl) timerEl.textContent = '';
      var btn = document.getElementById('sendOtpBtn');
      if (btn) { btn.disabled = false; btn.textContent = 'Resend OTP'; }
    }
  }, 1000);
}

async function sendOtp() {
  var phone = (document.getElementById('auth-phone-num').value || '').trim();
  var errEl = document.getElementById('auth-phone-err');
  errEl.classList.remove('show');
  if (phone.replace(/\D/g,'').length < 10) {
    errEl.textContent = 'Enter a valid 10-digit mobile number';
    errEl.classList.add('show'); return;
  }
  var btn = document.getElementById('sendOtpBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await callAuth('send_otp', { phone });
    document.getElementById('otpField').style.display = 'block';
    document.getElementById('verifyOtpBtn').style.display = 'block';
    btn.textContent = 'Sent ✓';
    startOtpTimer();
    setTimeout(function(){ document.getElementById('auth-otp').focus(); }, 100);
  } catch(e) {
    var msg = e.message || '';
    if (msg === 'SMS_NOT_CONFIGURED') {
      errEl.textContent = '📧 SMS abhi setup nahi hai — Email tab se login karo';
      // Auto switch to email tab
      setTimeout(function(){ switchAuthTab('email'); }, 1800);
    } else {
      errEl.textContent = msg || 'Failed to send OTP. Try again.';
    }
    errEl.classList.add('show');
    btn.disabled = false; btn.textContent = 'Send OTP';
  }
}

async function verifyOtp() {
  var phone = (document.getElementById('auth-phone-num').value || '').trim();
  var otp   = (document.getElementById('auth-otp').value || '').trim();
  var errEl = document.getElementById('auth-phone-err');
  errEl.classList.remove('show');
  if (!otp || otp.length < 4) {
    errEl.textContent = 'Enter the OTP sent to your phone';
    errEl.classList.add('show'); return;
  }
  var btn = document.getElementById('verifyOtpBtn');
  btn.disabled = true; btn.textContent = 'Verifying…';
  try {
    var data = await callAuth('verify_otp', { phone, token: otp });
    saveAuthSession(data);
    closeAuth();
    updateAccountBtn();
    showToast('🎉 Welcome to 5 Pahadi Roots!');
    handlePostLogin();
  } catch(e) {
    errEl.textContent = e.message || 'Invalid OTP. Try again.';
    errEl.classList.add('show');
    btn.disabled = false; btn.textContent = 'Verify & Login';
  }
}

async function emailLogin() {
  var email = (document.getElementById('auth-email-addr').value || '').trim();
  var pass  = (document.getElementById('auth-email-pass').value  || '');
  var errEl = document.getElementById('auth-email-err');
  errEl.classList.remove('show');
  if (!email || !pass) {
    errEl.textContent = 'Enter email and password'; errEl.classList.add('show'); return;
  }
  var btn = document.querySelector('#auth-email-login .auth-submit');
  btn.disabled = true; btn.textContent = 'Logging in…';
  try {
    var data = await callAuth('email_login', { email, password: pass });
    saveAuthSession(data);
    closeAuth();
    updateAccountBtn();
    showToast('🎉 Welcome back!');
    handlePostLogin();
  } catch(e) {
    errEl.textContent = e.message || 'Invalid email or password';
    errEl.classList.add('show');
    btn.disabled = false; btn.textContent = 'Login';
  }
}

async function emailSignup() {
  var name  = (document.getElementById('auth-signup-name').value  || '').trim();
  var email = (document.getElementById('auth-signup-email').value || '').trim();
  var pass  = (document.getElementById('auth-signup-pass').value  || '');
  var errEl = document.getElementById('auth-signup-err');
  errEl.classList.remove('show');
  if (!email || !pass) {
    errEl.textContent = 'Email and password required'; errEl.classList.add('show'); return;
  }
  if (pass.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters'; errEl.classList.add('show'); return;
  }
  var btn = document.querySelector('#auth-email-signup .auth-submit');
  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    var data = await callAuth('email_signup', { email, password: pass, full_name: name });
    saveAuthSession(data);
    closeAuth();
    updateAccountBtn();
    showToast('🎉 Account created! Welcome to 5 Pahadi Roots!');
  } catch(e) {
    errEl.textContent = e.message || 'Signup failed. Email may already be registered.';
    errEl.classList.add('show');
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

// ── Account Button State ────────────────────────────────────────
function updateAccountBtn() {
  var dot = document.getElementById('accountDot');
  if (dot) dot.style.display = _authToken ? 'block' : 'none';
  // Update dropdown state
  var ddName = document.getElementById('dd-name');
  var ddSub = document.getElementById('dd-sub');
  var ddLogin = document.getElementById('dd-login-btn');
  var ddLogout = document.getElementById('dd-logout-btn');
  // Update nav account button to show name when logged in
  var acctBtn = document.getElementById('accountBtn');
  if (_authToken && _authProfile) {
    var name = [_authProfile.first_name, _authProfile.last_name].filter(Boolean).join(' ') || 'Account';
    var firstName = name.split(' ')[0];
    var initial = (firstName[0] || '?').toUpperCase();
    if (ddName) ddName.textContent = 'Hi, ' + firstName + '! 👋';
    if (ddSub) ddSub.textContent = _authProfile.email || '';
    if (ddLogin) ddLogin.style.display = 'none';
    if (ddLogout) ddLogout.style.display = 'block';
    // Show name pill on button
    if (acctBtn) { acctBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;background:#f0f7f4;border:1.5px solid #c8e6c9;padding:4px 10px 4px 5px;border-radius:24px;font-size:12px;font-weight:800;color:#1a3a1e;white-space:nowrap;max-width:140px;overflow:hidden"><span style="width:24px;height:24px;min-width:24px;background:linear-gradient(135deg,#1a3a1e,#2d5233);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#fff">' + initial + '</span>Hi, ' + firstName.slice(0,10) + '</span>'; acctBtn.style.background = 'none'; acctBtn.style.border = 'none'; acctBtn.style.padding = '0'; }
  } else if (_authToken) {
    if (ddName) ddName.textContent = 'My Account';
    if (ddLogin) ddLogin.style.display = 'none';
    if (ddLogout) ddLogout.style.display = 'block';
    if (acctBtn) acctBtn.innerHTML = '👤';
  } else {
    if (ddName) ddName.textContent = 'Welcome!';
    if (ddSub) ddSub.textContent = 'Login to manage your account';
    if (ddLogin) ddLogin.style.display = 'block';
    if (ddLogout) ddLogout.style.display = 'none';
    if (acctBtn) acctBtn.innerHTML = '👤';
  }
}

var _acctDropTimer = null;
function showAcctDropdown() {
  clearTimeout(_acctDropTimer);
  updateAccountBtn();
  var dd = document.getElementById('acctDropdown');
  if (dd) dd.style.display = 'block';
}
function hideAcctDropdown() {
  _acctDropTimer = setTimeout(function() {
    var dd = document.getElementById('acctDropdown');
    if (dd) dd.style.display = 'none';
  }, 200);
}
function closeAcctDropdown() {
  var dd = document.getElementById('acctDropdown');
  if (dd) dd.style.display = 'none';
}

// ── Account Panel ───────────────────────────────────────────────
var _acctTab = 'orders';
var _acctData = null;

function goToAccount() {
  window.location.href = '/account';
}

function openAccount() {
  closeAcctDropdown();
  if (!_authToken) { openAuth(); return; }
  document.getElementById('acctPanel').classList.add('open');
  document.getElementById('acctBg').classList.add('open');
  document.body.style.overflow = 'hidden';
  loadAccountData();
}
function closeAccount() {
  document.getElementById('acctPanel').classList.remove('open');
  document.getElementById('acctBg').classList.remove('open');
  document.body.style.overflow = '';
}
function switchAcctTab(tab) {
  _acctTab = tab;
  document.querySelectorAll('.acct-tab').forEach(function(t,i){
    t.classList.toggle('active', ['orders','profile'][i] === tab);
  });
  renderAcctTab();
}

async function loadAccountData() {
  document.getElementById('acctBody').innerHTML = '<div class="acct-loading">🌿 Loading…</div>';
  try {
    var data = await callAuth('get_profile', {}, true);
    _acctData = data;
    // Always keep _authProfile and _authUser in sync
    if (data.profile) _authProfile = data.profile;
    if (data.user)    _authUser    = data.user;
    // Update header
    var p = data.profile || {};
    var name = [p.first_name, p.last_name].filter(Boolean).join(' ') || data.user.email || data.user.phone || 'Customer';
    document.getElementById('acctName').textContent  = name;
    document.getElementById('acctSub').textContent   = data.user.email || data.user.phone || '';
    document.getElementById('acctAvatar').textContent = name[0] ? name[0].toUpperCase() : '👤';
    renderAcctTab();
  } catch(e) {
    if (e.message && e.message.includes('Session expired')) {
      clearAuthSession(); updateAccountBtn(); closeAccount();
      showToast('Session expire ho gayi — pehle login karo, cart safe hai!');
      try { localStorage.setItem('pr_return_to', 'cart'); } catch(e) {}
      setTimeout(openAuth, 600);
    } else {
      document.getElementById('acctBody').innerHTML = '<div class="acct-loading">⚠️ Could not load account. Please try again.</div>';
    }
  }
}

function renderAcctTab() {
  if (!_acctData) return;
  var body = document.getElementById('acctBody');
  if (_acctTab === 'orders') body.innerHTML = renderOrders(_acctData.orders || []);
  else if (_acctTab === 'profile') body.innerHTML = renderProfile(_acctData.profile || {}, _acctData.user || {}) + renderAddress(_acctData.profile || {});
}

function renderOrders(orders) {
  if (!orders.length) return '<div class="acct-loading" style="padding:40px">📦 No orders yet.<br><br><small>Your orders will appear here after you shop.</small></div>';
  var statusClass = {pending:'os-pending',confirmed:'os-confirmed',processing:'os-processing',shipped:'os-shipped',delivered:'os-delivered',cancelled:'os-cancelled'};
  var courierUrls = {
    'Delhivery': 'https://www.delhivery.com/track/package/',
    'BlueDart': 'https://www.bluedart.com/tracking?trackFor=0&trackNum=',
    'DTDC': 'https://tracking.dtdc.com/ctbs-tracking/customerInterface.tr?submitName=showCustLoginPage&cType=self&trackType=cnNo&strCNno=',
    'Ekart': 'https://ekartlogistics.com/shipmenttrack/',
    'Xpressbees': 'https://www.xpressbees.com/track?awbnumber=',
  };
  return '<div class="acct-section"><div class="acct-section-title">Your Orders (' + orders.length + ')</div>' +
    orders.map(function(o) {
      var items = (o.items||[]).slice(0,2).map(function(i){ return (i.emoji||'🌿') + ' ' + i.name + ' ×' + i.qty; }).join(', ');
      if (o.items && o.items.length > 2) items += ' +' + (o.items.length-2) + ' more';
      var sc = statusClass[o.order_status] || 'os-pending';
      var date = o.created_at ? new Date(o.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '';
      // Tracking link
      var trackHtml = '';
      if (o.tracking_number) {
        var tUrl = courierUrls[o.courier] ? courierUrls[o.courier] + o.tracking_number : ('https://www.google.com/search?q=' + encodeURIComponent((o.courier||'') + ' tracking ' + o.tracking_number));
        trackHtml = '<a href="' + tUrl + '" target="_blank" style="display:inline-flex;align-items:center;gap:4px;margin-top:8px;background:#1a3a1e;color:#fff;padding:5px 12px;border-radius:20px;font-size:11px;font-weight:700;text-decoration:none">🚚 Track — ' + o.tracking_number + '</a>';
      }
      // View order link
      var viewLink = o.id ? '<a href="/order-confirmation?id=' + o.id + '&num=' + encodeURIComponent(o.order_number||'') + '" style="font-size:11px;color:#2d6a4f;font-weight:700;text-decoration:none;margin-left:8px">View →</a>' : '';
      return '<div class="order-card">' +
        '<div class="order-card-hdr"><span class="order-num">' + (o.order_number||'#'+o.id.slice(0,8)) + viewLink + '</span>' +
        '<span class="order-status ' + sc + '">' + (o.order_status||'pending') + '</span></div>' +
        '<div class="order-items">' + (items || 'Items loading…') + '</div>' +
        trackHtml +
        '<div class="order-footer" style="margin-top:8px"><span class="order-total">₹' + (o.total_amount||0).toLocaleString('en-IN') + '</span>' +
        '<span class="order-date">' + date + '</span></div></div>';
    }).join('') + '</div>';
}

function renderAddress(p) {
  var addrs = getSavedAddresses();
  // Show saved addresses (exclude Default — that's shown separately)
  var extraAddrs = addrs.filter(function(a){ return a.label !== 'Default'; });
  var savedList = extraAddrs.length ? 
    '<div class="acct-section-title" style="margin-top:16px">📋 Saved Addresses</div>' +
    extraAddrs.map(function(a, i) {
      return '<div style="background:#f0f7f2;border-radius:10px;padding:10px 12px;margin-bottom:8px;font-size:13px">' +
        '<div style="font-weight:700;color:#1a5c2a">📍 ' + (a.label||'Address '+(i+1)) + '</div>' +
        '<div style="color:#555;margin-top:2px">' + a.name + (a.name ? ' · ' : '') + a.addr + ', ' + a.city + ' - ' + a.pin + '</div>' +
        '<button onclick="deleteSavedAddress(' + i + ')" style="margin-top:6px;background:none;border:none;color:#c0392b;font-size:11px;cursor:pointer;padding:0">🗑 Remove</button>' +
        '</div>';
    }).join('') : '';

  return '<div class="acct-section"><div class="acct-section-title">📍 Default Address</div>' +
    '<div class="profile-field"><label>Address Line</label><input class="profile-input" id="pf-addr" value="' + (p.address_line1||'') + '" placeholder="House/Street"></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
    '<div class="profile-field"><label>City</label><input class="profile-input" id="pf-city" value="' + (p.city||'') + '" placeholder="City"></div>' +
    '<div class="profile-field"><label>State</label><input class="profile-input" id="pf-state" value="' + (p.state||'') + '" placeholder="State"></div>' +
    '</div>' +
    '<div class="profile-field" style="max-width:160px"><label>Pincode</label><input class="profile-input" id="pf-pin" value="' + (p.postal_code||'') + '" placeholder="Pincode" maxlength="6"></div>' +
    '<button class="acct-btn acct-btn-p" onclick="saveAddress()" style="margin-top:8px">💾 Save as Default</button>' +
    '<div id="addr-msg" style="font-size:12px;margin-top:8px;color:#2d6a4f;display:none">✓ Address saved!</div>' +
    savedList +
    '<div class="acct-section-title" style="margin-top:16px">➕ Add Another Address</div>' +
    '<div class="profile-field"><label>Label</label>' +
    '<select class="profile-input" id="new-addr-label" style="background:#fff;cursor:pointer;height:44px">' +
    '<option value="">— Select Label —</option>' +
    '<option value="Home">🏠 Home</option>' +
    '<option value="Office">🏢 Office</option>' +
    '<option value="Parents">👨‍👩‍👧 Parents</option>' +
    '<option value="Others">📍 Others</option>' +
    '</select>' +
    '<div class="profile-field"><label>Full Name</label><input class="profile-input" id="new-addr-name" placeholder="Recipient name"></div>' +
    '<div class="profile-field"><label>Phone</label><input class="profile-input" id="new-addr-phone" placeholder="10-digit mobile" type="tel"></div>' +
    '<div class="profile-field"><label>Address Line</label><input class="profile-input" id="new-addr-addr" placeholder="House/Street/Area"></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
    '<div class="profile-field"><label>City</label><input class="profile-input" id="new-addr-city" placeholder="City"></div>' +
    '<div class="profile-field"><label>State</label><input class="profile-input" id="new-addr-state" placeholder="State"></div>' +
    '</div>' +
    '<div class="profile-field" style="max-width:160px"><label>Pincode</label><input class="profile-input" id="new-addr-pin" placeholder="Pincode" maxlength="6"></div>' +
    '<button id="new-addr-save-btn" class="acct-btn acct-btn-p" onclick="saveNewAddress()" style="margin-top:8px;background:#1a5c2a">💾 Save Address</button>' +
    '<div id="new-addr-msg" style="font-size:12px;margin-top:8px;color:#2d6a4f;display:none">✓ Address added!</div>' +
    '</div>';
}

function renderProfile(p, user) {
  var linkedPhone = (user.phone || '').replace(/^\+91/, '');
  var linkedEmail = user.email || '';
  return '<div class="acct-section"><div class="acct-section-title">Personal Info</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
    '<div class="profile-field"><label>First Name</label><input class="profile-input" id="pf-fname" value="' + (p.first_name||'') + '" placeholder="First name"></div>' +
    '<div class="profile-field"><label>Last Name</label><input class="profile-input" id="pf-lname" value="' + (p.last_name||'') + '" placeholder="Last name"></div>' +
    '</div>' +
    '<button class="acct-btn acct-btn-p" onclick="saveProfile()" style="margin-top:4px;margin-bottom:16px">💾 Save</button>' +
    '<div id="profile-msg" style="font-size:12px;margin-bottom:12px;color:#2d6a4f;display:none">✓ Profile saved!</div>' +
    '</div>' +
    '<div class="acct-section">' +
    '<div class="acct-section-title">Linked Accounts</div>' +
    (linkedPhone
      ? '<div style="padding:10px 12px;background:#e8f5e9;border-radius:9px;font-size:13px;margin-bottom:8px">📱 Phone: <strong>' + linkedPhone + '</strong> <span style="color:#2d6a4f">✓ Linked</span></div>'
      : '<div class="link-section"><div class="link-section-title">📱 Link Phone Number</div><div style="display:flex;gap:8px"><input class="profile-input" id="link-phone" type="tel" placeholder="+91 9XXXXXXXXX" style="flex:1"><button class="acct-btn acct-btn-p" onclick="linkPhone()">Link</button></div><div id="link-phone-msg" style="font-size:12px;margin-top:6px;color:#c0392b;display:none"></div></div>') +
    (linkedEmail
      ? '<div style="padding:10px 12px;background:#e8f5e9;border-radius:9px;font-size:13px;margin-bottom:8px">📧 Email: <strong>' + linkedEmail + '</strong> <span style="color:#2d6a4f">✓ Linked</span></div>'
      : '<div class="link-section"><div class="link-section-title">📧 Link Email</div><div class="profile-field"><input class="profile-input" id="link-email" type="email" placeholder="your@email.com"></div><div class="profile-field"><input class="profile-input" id="link-email-pass" type="password" placeholder="Set a password (min 6 chars)"></div><button class="acct-btn acct-btn-p" onclick="linkEmail()">Link Email</button><div id="link-email-msg" style="font-size:12px;margin-top:6px;color:#c0392b;display:none"></div></div>') +
    '</div>' +
    '<div class="acct-section" style="margin-top:4px">' +
    '<div class="acct-section-title">🔒 Change Password</div>' +
    '<div class="profile-field"><label>New Password</label><input class="profile-input" id="cp-new" type="password" placeholder="Minimum 6 characters"></div>' +
    '<div class="profile-field"><label>Confirm Password</label><input class="profile-input" id="cp-confirm" type="password" placeholder="Repeat new password"></div>' +
    '<button class="acct-btn acct-btn-p" onclick="changePassword()" style="margin-top:4px">🔒 Update Password</button>' +
    '<div id="cp-msg" style="font-size:12px;margin-top:8px;display:none"></div>' +
    '</div>' +
    '<div style="margin-top:8px"><button class="acct-btn acct-btn-r" onclick="logoutAccount()">🚪 Logout</button></div>';
}

async function changePassword() {
  var np = (document.getElementById('cp-new') || {}).value || '';
  var cp = (document.getElementById('cp-confirm') || {}).value || '';
  var msg = document.getElementById('cp-msg');
  if (!np || np.length < 6) {
    if (msg) { msg.style.color='#c0392b'; msg.textContent='❌ Password min 6 characters chahiye'; msg.style.display='block'; }
    return;
  }
  if (np !== cp) {
    if (msg) { msg.style.color='#c0392b'; msg.textContent='❌ Passwords match nahi kar rahe'; msg.style.display='block'; }
    return;
  }
  try {
    if (msg) { msg.style.color='#888'; msg.textContent='Updating...'; msg.style.display='block'; }
    await callAuth('change_password', { new_password: np }, true);
    if (msg) { msg.style.color='#2d6a4f'; msg.textContent='✅ Password updated successfully!'; }
    document.getElementById('cp-new').value = '';
    document.getElementById('cp-confirm').value = '';
    setTimeout(function(){ if(msg) msg.style.display='none'; }, 3000);
  } catch(e) {
    if (msg) { msg.style.color='#c0392b'; msg.textContent='❌ ' + (e.message || 'Update failed'); msg.style.display='block'; }
  }
}

// ── Profile Save Actions ────────────────────────────────────────
async function saveAddress() {
  try {
    var updates = {
      address_line1: document.getElementById('pf-addr').value.trim(),
      city:          document.getElementById('pf-city').value.trim(),
      state:         document.getElementById('pf-state').value.trim(),
      postal_code:   document.getElementById('pf-pin').value.trim(),
    };
    await callAuth('update_profile', updates, true);
    if (_acctData && _acctData.profile) Object.assign(_acctData.profile, updates);
    if (_authProfile) Object.assign(_authProfile, updates);
    var msg = document.getElementById('addr-msg');
    if (msg) { msg.style.display = 'block'; setTimeout(function(){ msg.style.display='none'; }, 2500); }
    var fields = { 'del-addr': updates.address_line1, 'del-city': updates.city, 'del-state': updates.state, 'del-pin': updates.postal_code };
    Object.entries(fields).forEach(function(kv){ var el = document.getElementById(kv[0]); if(el) el.value = kv[1]; });
  } catch(e) { showToast('❌ ' + (e.message || 'Save failed')); }
}

async function saveNewAddress() {
  var label = (document.getElementById('new-addr-label').value || '').trim();
  var name  = (document.getElementById('new-addr-name').value  || '').trim();
  var phone = (document.getElementById('new-addr-phone').value || '').trim();
  var addr  = (document.getElementById('new-addr-addr').value  || '').trim();
  var city  = (document.getElementById('new-addr-city').value  || '').trim();
  var state = (document.getElementById('new-addr-state').value || '').trim();
  var pin   = (document.getElementById('new-addr-pin').value   || '').trim();
  if (!addr || !city || !pin) { showToast('❌ Address, City aur Pincode zaroori hai'); return; }
  var btn = document.getElementById('new-addr-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '💾 Saving…'; }
  var addrs = getSavedAddresses();
  // Remove existing with same label
  addrs = addrs.filter(function(a){ return a.label !== 'Default'; });
  addrs.push({ label: label || 'Address ' + (addrs.length + 1), name: name, phone: phone, addr: addr, city: city, state: state, pin: pin });
  await setSavedAddresses(addrs);
  ['new-addr-label','new-addr-name','new-addr-phone','new-addr-addr','new-addr-city','new-addr-state','new-addr-pin'].forEach(function(id){
    var el = document.getElementById(id); if(el) el.value = '';
  });
  if (btn) { btn.disabled = false; btn.textContent = '💾 Save Address'; }
  var msg = document.getElementById('new-addr-msg');
  if (msg) { msg.style.display = 'block'; setTimeout(function(){ msg.style.display='none'; }, 2000); }
  showToast('✅ ' + (label || 'Address') + ' save ho gaya!');
  setTimeout(function(){ loadAccountData(); }, 400);
}

async function deleteSavedAddress(idx) {
  var addrs = getSavedAddresses().filter(function(a){ return a.label !== 'Default'; });
  addrs.splice(idx, 1);
  await setSavedAddresses(addrs);
  showToast('🗑 Address remove ho gaya');
  setTimeout(function(){ loadAccountData(); }, 400);
}

async function saveProfile() {
  try {
    var updates = {
      first_name: document.getElementById('pf-fname').value.trim(),
      last_name:  document.getElementById('pf-lname').value.trim(),
    };
    await callAuth('update_profile', updates, true);
    if (_acctData && _acctData.profile) Object.assign(_acctData.profile, updates);
    if (_authProfile) Object.assign(_authProfile, updates);
    var name = [updates.first_name, updates.last_name].filter(Boolean).join(' ');
    if (name) {
      var acctName = document.getElementById('acctName');
      var acctAvtr = document.getElementById('acctAvatar');
      if (acctName) acctName.textContent = name;
      if (acctAvtr) acctAvtr.textContent = name[0].toUpperCase();
      // Also update cart delivery name if it matches old name
      var delName = document.getElementById('del-name');
      if (delName) delName.value = name;
    }
    var msg = document.getElementById('profile-msg');
    if (msg) { msg.style.display = 'block'; setTimeout(function(){ msg.style.display='none'; }, 2500); }
    showToast('✅ Profile saved!');
  } catch(e) { showToast('❌ ' + (e.message || 'Save failed')); }
}

async function linkPhone() {
  var phone = (document.getElementById('link-phone').value || '').trim();
  var msgEl = document.getElementById('link-phone-msg');
  try {
    msgEl.style.display = 'block'; msgEl.style.color = '#888'; msgEl.textContent = 'Linking…';
    await callAuth('link_phone', { phone }, true);
    showToast('✅ Phone linked!');
    loadAccountData();
  } catch(e) {
    var msg = e.message || '';
    if (msg.includes('23505') || msg.includes('already exists') || msg.includes('duplicate')) {
      msgEl.textContent = '⚠️ Yeh number pehle se kisi account se linked hai';
    } else {
      msgEl.textContent = msg || 'Phone link nahi ho saka';
    }
    msgEl.style.color = '#c0392b';
  }
}

async function linkEmail() {
  var email = (document.getElementById('link-email').value || '').trim();
  var pass  = (document.getElementById('link-email-pass').value || '');
  var msgEl = document.getElementById('link-email-msg');
  try {
    msgEl.style.display = 'block'; msgEl.style.color = '#888'; msgEl.textContent = 'Linking…';
    await callAuth('link_email', { email, password: pass }, true);
    showToast('✅ Email linked!');
    loadAccountData();
  } catch(e) { msgEl.textContent = e.message || 'Failed to link email'; msgEl.style.color = '#c0392b'; }
}

async function logoutAccount() {
  try { await callAuth('logout', {}, true); } catch(e) {}
  clearAuthSession();
  updateAccountBtn();
  closeAccount();
  showToast('👋 Logged out successfully');
  setTimeout(function() { window.location.reload(); }, 1500);
}

// ── Forgot / Reset Password ─────────────────────────────────────
var _forgotEmail = '';
var _resendTimer = null;

function startResendCountdown() {
  var secs = 30;
  var cd  = document.getElementById('resend-countdown');
  var btn = document.getElementById('resendBtn');
  if (!cd || !btn) return;
  btn.style.display = 'none';
  btn.disabled = false;
  clearInterval(_resendTimer);
  cd.textContent = 'Resend available in ' + secs + 's';
  _resendTimer = setInterval(function() {
    secs--;
    cd.textContent = 'Resend available in ' + secs + 's';
    if (secs <= 0) {
      clearInterval(_resendTimer);
      cd.textContent = '';
      btn.style.display = 'block';
      btn.disabled = false;
      btn.textContent = '🔄 Resend Reset Link';
    }
  }, 1000);
}

async function forgotPassword() {
  var email = (document.getElementById('auth-forgot-email').value || '').trim();
  var errEl = document.getElementById('auth-forgot-err');
  var sucEl = document.getElementById('auth-forgot-success');
  errEl.classList.remove('show'); sucEl.style.display = 'none';
  if (!email) { errEl.textContent = 'Please enter your email address'; errEl.classList.add('show'); return; }
  if (!email.includes('@')) { errEl.textContent = 'Please enter a valid email address'; errEl.classList.add('show'); return; }
  var btn = document.getElementById('forgotBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  _forgotEmail = email;
  try {
    await callAuth('forgot_password', { email });
    sucEl.style.display = 'block';
    btn.style.display = 'none';
    startResendCountdown();
  } catch(e) {
    // Show actual error to help debug
    var msg = e.message || 'Could not send reset email — please try again';
    errEl.textContent = '❌ ' + msg;
    errEl.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Send Reset Link';
    console.error('[forgotPassword] Error:', e.message);
  }
}

async function resendResetLink() {
  if (!_forgotEmail) return;
  var btn = document.getElementById('resendBtn');
  var cd  = document.getElementById('resend-countdown');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await callAuth('forgot_password', { email: _forgotEmail });
    btn.textContent = '✅ Sent!';
    setTimeout(function() {
      btn.disabled = false;
      btn.textContent = '🔄 Resend Reset Link';
      startResendCountdown();
    }, 1500);
  } catch(e) {
    btn.disabled = false;
    btn.textContent = '🔄 Resend Reset Link';
    console.error('[resendResetLink] Error:', e.message);
  }
}

// ── Handle reset link from email (runs on page load) ───────────
(function checkResetToken() {
  var hash = window.location.hash;
  if (!hash) return;
  var params = {};
  hash.slice(1).split('&').forEach(function(p) {
    var kv = p.split('='); params[kv[0]] = decodeURIComponent(kv[1] || '');
  });
  if (params.type === 'recovery' && params.access_token) {
    // Redirect to dedicated full-page reset experience
    window.location.href = '/reset-password#access_token=' + encodeURIComponent(params.access_token) + '&type=recovery';
  }
})();

function showResetPasswordModal(token) {
  var overlay = document.getElementById('authModal');
  var box = document.querySelector('.auth-box');
  if (!box || !overlay) return;
  box.innerHTML =
    '<div style="background:linear-gradient(135deg,#1a3a1e,#2d6a4f);padding:28px 24px 20px;text-align:center;position:sticky;top:0;z-index:2">' +
      '<div style="font-size:32px;margin-bottom:6px">🌿</div>' +
      '<div style="font-size:18px;font-weight:800;color:#fff;">5 Pahadi Roots</div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">Himalayan Organic Store</div>' +
    '</div>' +
    '<div style="padding:32px 24px">' +
      '<div style="text-align:center;margin-bottom:28px">' +
        '<div style="width:60px;height:60px;background:#e8f5e9;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 14px">🔑</div>' +
        '<div style="font-size:22px;font-weight:800;color:#1a3a1e;margin-bottom:8px">Set New Password</div>' +
        '<div style="font-size:14px;color:#888;line-height:1.6">Choose a strong password to secure your account</div>' +
      '</div>' +
      '<div style="margin-bottom:18px">' +
        '<label class="auth-label">New Password</label>' +
        '<input class="auth-input" id="reset-pass" type="password" placeholder="Minimum 6 characters">' +
      '</div>' +
      '<div style="margin-bottom:24px">' +
        '<label class="auth-label">Confirm Password</label>' +
        '<input class="auth-input" id="reset-pass2" type="password" placeholder="Re-enter your password">' +
      '</div>' +
      '<div class="auth-err" id="reset-err" style="margin-bottom:14px"></div>' +
      '<button class="auth-submit" id="resetBtn" onclick="submitResetPassword(\'' + token + '\')">Update Password</button>' +
      '<div style="text-align:center;margin-top:16px"><a onclick="closeAuth()" style="font-size:13px;color:#aaa;cursor:pointer">Cancel</a></div>' +
    '</div>';
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(function() { var i = document.getElementById('reset-pass'); if(i) i.focus(); }, 300);
}

async function submitResetPassword(token) {
  var pass  = (document.getElementById('reset-pass').value  || '');
  var pass2 = (document.getElementById('reset-pass2').value || '');
  var errEl = document.getElementById('reset-err');
  errEl.classList.remove('show');
  if (pass.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; errEl.classList.add('show'); return; }
  if (pass !== pass2)  { errEl.textContent = 'Passwords do not match'; errEl.classList.add('show'); return; }
  var btn = document.getElementById('resetBtn');
  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    var controller = new AbortController();
    var timeoutId  = setTimeout(function(){ controller.abort(); }, 20000); // 20s timeout
    var res = await fetch(getStoreApiBase() + '/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action: 'reset_password', password: pass }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Reset failed');
    closeAuth();
    showToast('✅ Password updated! Please login with your new password.');
    setTimeout(openAuth, 1200);
  } catch(e) {
    var msg = e.name === 'AbortError'
      ? 'Request timed out — please try again'
      : (e.message || 'Reset failed — link may have expired, please request a new one');
    errEl.textContent = msg;
    errEl.classList.add('show');
    btn.disabled = false; btn.textContent = 'Update Password';
    console.error('[submitResetPassword] Error:', e.message);
  }
}

// ── Auto-fill delivery form from account address ────────────────
function prefillDelivery() {
  // First try account profile (highest priority)
  if (_authProfile) {
    var p = _authProfile;
    var map = {
      'del-name':  [p.first_name, p.last_name].filter(Boolean).join(' '),
      'del-phone': (p.phone || '').replace(/^\+91/, '').replace(/\D/g,'').slice(-10),
      'del-addr':  p.address_line1 || '',
      'del-city':  p.city || '',
      'del-state': p.state || '',
      'del-pin':   p.postal_code || '',
      'del-email': p.email || (_authUser && _authUser.email) || '',
    };
    var anyFilled = false;
    Object.entries(map).forEach(function(kv){
      if (kv[1]) { var el = document.getElementById(kv[0]); if(el && !el.value) { el.value = kv[1]; anyFilled = true; } }
    });
    if (anyFilled) return;
  }
  // Fallback: localStorage
  try {
    var d = JSON.parse(localStorage.getItem('pr_cust_info') || '{}');
    if (d.name)  { var el = document.getElementById('del-name');  if(el && !el.value) el.value = d.name; }
    if (d.phone) { var el = document.getElementById('del-phone'); if(el && !el.value) el.value = d.phone; }
    if (d.addr)  { var el = document.getElementById('del-addr');  if(el && !el.value) el.value = d.addr; }
    if (d.city)  { var el = document.getElementById('del-city');  if(el && !el.value) el.value = d.city; }
    if (d.state) { var el = document.getElementById('del-state'); if(el && !el.value) el.value = d.state; }
    if (d.pin)   { var el = document.getElementById('del-pin');   if(el && !el.value) el.value = d.pin; }
    if (d.email) { var el = document.getElementById('del-email'); if(el && !el.value) el.value = d.email; }
  } catch(e) {}
}

// ── Boot: restore session UI ────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  updateAccountBtn();
  // opencart=1 handled in loadData()
  // Open orders tab if redirected from order confirmation page
  if (window.location.search.includes('openorders=1')) {
    history.replaceState(null, '', '/');
    if (_authToken) {
      setTimeout(function() { openAccount(); }, 500);
    }
  }
  // Open auth modal if redirected from account page or other pages with ?login=1
  if (window.location.search.includes('login=1')) {
    history.replaceState(null, '', '/');
    setTimeout(function() { openAuth(); }, 400);
  }
  // Update WA float button href dynamically
  var waBtn = document.getElementById('waFloatBtn');
  if (waBtn) waBtn.href = 'https://wa.me/' + WHATSAPP_NUMBER;
  // One-time wishlist hint
  if (!localStorage.getItem('pr_wl_hint_shown'
  ));
  if (!localStorage.getItem('pr_wl_hint_shown')) {
    localStorage.setItem('pr_wl_hint_shown', '1');
    setTimeout(function() { showToast('❤️ Tap the heart to save favourites!'); }, 3000);
  }
});