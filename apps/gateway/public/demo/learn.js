document.querySelector("#check").addEventListener("click", () => {
  document.querySelector("#feedback").textContent =
    document.querySelector("#answer").value.trim() === "4"
      ? "Correct: x = 4. Explain why both operations preserve equality."
      : "Try again: subtract 6 from each side, then divide by 3.";
});
