
document.addEventListener('DOMContentLoaded', function() {
  const input = document.getElementById('user-input');
  const button = document.getElementById('send-btn');
  const chatBody = document.getElementById('chat-body');

  function appendMessage(text, sender) {
    const div = document.createElement('div');
    div.className = sender === 'user' ? 'user-msg' : 'bot-msg';
    div.textContent = text;
    chatBody.appendChild(div);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function sendMessage() {
    const message = input.value;
    if (!message.trim()) return;
    appendMessage(message, 'user');
    input.value = '';

    fetch('/api/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ message })
    })
    .then(res => res.json())
    .then(data => appendMessage(data.reply, 'bot'))
    .catch(() => appendMessage('Error contacting Boogie.', 'bot'));
  }

  button.addEventListener('click', sendMessage);
  input.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') sendMessage();
  });
});
