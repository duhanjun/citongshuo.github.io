/* ===========================================================
 * sw-registration.js
 * ===========================================================
 * Copyright 2016 @huxpro
 * Licensed under Apache 2.0
 * Register service worker.
 * ========================================================== */
function handleRegistration(e){console.log("Service Worker Registered. ",e),e.onupdatefound=()=>{const o=e.installing;o.onstatechange=()=>{"installed"===o.state&&(navigator.serviceWorker.controller?console.log("SW is updated"):(console.log("A Visit without previous SW"),createSnackbar({message:"App ready for offline use.",duration:3e3})))}}}navigator.serviceWorker&&navigator.serviceWorker.register("/sw.js").then(e=>handleRegistration(e)).catch(e=>{console.log("ServiceWorker registration failed: ",e)});