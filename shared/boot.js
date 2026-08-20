/* HireFlow shared namespace — safe in SW, pages, and content scripts. */
(function (root) {
  root.HireFlow = root.HireFlow || {};
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
