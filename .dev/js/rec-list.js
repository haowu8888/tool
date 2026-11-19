// The 屏幕录制 page's list, and whether its first video loads.
(async () => {
  document.querySelector('.nav-item[data-id="record"]').click();
  await new Promise((r) => setTimeout(r, 1500));
  const v = document.querySelector(".rc-thumb video");
  return {
    visible: document.visibilityState,
    items: [...document.querySelectorAll(".rc-item")].map((el) => el.innerText.replace(/\s+/g, " ")),
    video: v && { ready: v.readyState, w: v.videoWidth, h: v.videoHeight, dur: v.duration, err: v.error?.message },
  };
})();
