(function (root) {
  const HF = root.HireFlow || (root.HireFlow = {});
  const HOST_ID = "hireflow-hud-host";

  function ensure() {
    let host = document.getElementById(HOST_ID);
    if (host && host.shadowRoot) return host.shadowRoot;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.zIndex = "2147483646";
    host.style.top = "16px";
    host.style.right = "16px";
    host.style.pointerEvents = "none";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          pointer-events: auto;
          min-width: 240px;
          max-width: 340px;
          background: #ffffff;
          color: #191919;
          border: 1px solid #e0e0e0;
          border-radius: 10px;
          box-shadow: 0 4px 16px rgba(0,0,0,.15);
          font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          padding: 12px 14px;
          display: none;
        }
        .card.on { display: block; }
        .row { display: flex; gap: 10px; align-items: flex-start; }
        .dot {
          width: 10px; height: 10px; border-radius: 50%;
          background: #0a66c2; margin-top: 5px; flex: none;
          box-shadow: 0 0 0 4px rgba(10,102,194,.15);
        }
        .dot.warn { background: #b25900; box-shadow: 0 0 0 4px rgba(178,89,0,.15); }
        .dot.err { background: #cc1010; box-shadow: 0 0 0 4px rgba(204,16,16,.15); }
        .dot.ok { background: #057642; box-shadow: 0 0 0 4px rgba(5,118,66,.15); }
        .kicker { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #0a66c2; font-weight: 700; }
        .msg { font-size: 13px; line-height: 1.4; margin-top: 2px; color: #191919; font-weight: 600; }
        .sub { font-size: 11px; color: #5e5e5e; margin-top: 2px; }
      </style>
      <div class="card" id="card">
        <div class="row">
          <div class="dot" id="dot"></div>
          <div>
            <div class="kicker">HireFlow</div>
            <div class="msg" id="msg">Working…</div>
            <div class="sub" id="sub"></div>
          </div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(host);
    return shadow;
  }

  function show(message, opts) {
    const shadow = ensure();
    const card = shadow.getElementById("card");
    const msg = shadow.getElementById("msg");
    const sub = shadow.getElementById("sub");
    const dot = shadow.getElementById("dot");
    msg.textContent = message || "Working…";
    sub.textContent = (opts && opts.sub) || "";
    dot.className = "dot " + ((opts && opts.kind) || "");
    card.classList.add("on");
  }

  function hide() {
    const host = document.getElementById(HOST_ID);
    if (!host || !host.shadowRoot) return;
    host.shadowRoot.getElementById("card").classList.remove("on");
  }

  HF.hud = { show, hide };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
