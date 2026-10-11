document.querySelector("#registration").addEventListener("submit", (event) => {
  event.preventDefault();
  event.currentTarget.hidden = true;
  document.querySelector("#registration-success").hidden = false;
});
