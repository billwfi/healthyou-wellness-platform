/* HealYou admin auth — a drop-in replacement for the Netlify Identity widget.
 *
 * The admin portal now authenticates against the app_users table (see
 * netlify/functions/login.js). This shim exposes the same `netlifyIdentity`
 * surface the admin pages already use — on('init'|'login'|'logout'), logout(),
 * open(), currentUser().jwt() — so those pages work unchanged. The session
 * token (an HS256 JWT from /api/login) is kept in localStorage.
 */
(function () {
  var KEY = 'hy_admin_token';
  var LOGIN_PAGE = '/admin/login.html';
  var handlers = { init: [], login: [], logout: [], error: [] };

  function getToken() { try { return localStorage.getItem(KEY) || null; } catch (e) { return null; } }
  function setToken(t) { try { localStorage.setItem(KEY, t); } catch (e) {} }
  function clearToken() { try { localStorage.removeItem(KEY); } catch (e) {} }

  // Decode a JWT payload without verifying (the server verifies the signature).
  function decode(token) {
    try {
      var b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      // decodeURIComponent(escape(...)) turns the byte string into proper UTF-8.
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (e) { return null; }
  }

  function claimsOrNull() {
    var t = getToken();
    if (!t) return null;
    var c = decode(t);
    if (!c || !c.email) { return null; }
    if (c.exp && Date.now() / 1000 > c.exp) { clearToken(); return null; }
    return c;
  }

  // Build the user object the pages expect: u.token.access_token, u.email,
  // u.user_metadata.full_name, and an async u.jwt(force) that returns the token.
  function buildUser() {
    var t = getToken();
    var c = t ? claimsOrNull() : null;
    if (!c) return null;
    return {
      token: { access_token: t },
      email: c.email,
      role: c.role || 'User',
      nav_categories: c.nav_categories || [],
      coach_portal: !!c.coach_portal,
      screener_portal: !!c.screener_portal,
      user_metadata: { full_name: c.full_name || c.email },
      jwt: function () {
        // Re-read from storage; return null if the session has expired.
        var cur = claimsOrNull();
        return Promise.resolve(cur ? getToken() : null);
      },
    };
  }

  function emit(evt, arg) {
    (handlers[evt] || []).forEach(function (fn) { try { fn(arg); } catch (e) {} });
  }

  function gotoLogin() {
    var next = encodeURIComponent(location.pathname + location.search);
    location.href = LOGIN_PAGE + '?next=' + next;
  }

  var api = {
    on: function (evt, cb) { if (handlers[evt]) handlers[evt].push(cb); },
    off: function (evt, cb) { if (handlers[evt]) handlers[evt] = handlers[evt].filter(function (f) { return f !== cb; }); },
    open: function () { gotoLogin(); },
    close: function () {},
    currentUser: function () { return buildUser(); },
    logout: function () { clearToken(); emit('logout'); },
    // Called by login.html after a successful /api/login.
    _setToken: function (t) { setToken(t); },
  };

  // Fire 'init' once the page's inline handlers have been registered.
  function fireInit() { emit('init', buildUser()); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(fireInit, 0); });
  } else {
    setTimeout(fireInit, 0);
  }

  window.netlifyIdentity = api;
  window.hyAuth = { KEY: KEY, getToken: getToken, setToken: setToken, clearToken: clearToken };
})();
