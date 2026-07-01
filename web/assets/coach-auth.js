/* HealthYou Coach Portal auth — passwordless (magic-link) session token.
 * Coaches are in the coaches table (not app_users). The portal stores a coach
 * session JWT (from /api/coach-login) in localStorage and reads coach_id/name
 * from its claims. */
(function () {
  var KEY = 'hy_coach_token';
  function getToken() { try { return localStorage.getItem(KEY) || null; } catch (e) { return null; } }
  function setToken(t) { try { localStorage.setItem(KEY, t); } catch (e) {} }
  function clearToken() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function decode(t) {
    try {
      var b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (e) { return null; }
  }
  // Valid, unexpired claims for a coach, or null.
  function claims() {
    var t = getToken();
    if (!t) return null;
    var c = decode(t);
    if (!c || !c.coach_id) return null;
    if (c.exp && Date.now() / 1000 > c.exp) { clearToken(); return null; }
    return c;
  }
  window.hyCoach = { KEY: KEY, getToken: getToken, setToken: setToken, clearToken: clearToken, claims: claims };
})();
