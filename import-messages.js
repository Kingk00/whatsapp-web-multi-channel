const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://mobokomuxbfqbuzwasbe.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vYm9rb211eGJmcWJ1endhc2JlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzcxNTgxMiwiZXhwIjoyMDgzMjkxODEyfQ.ZiMtCiJbXqdyTBbOvCcxyJJuHtQ7T8NZ_mt3OdwPKS8'
);

const channelId = '47ba3b99-0575-49ec-9966-612f689fc278';
const workspaceId = 'a0000000-0000-0000-0000-000000000001';

async function importMessages() {
  // Fetch messages from Whapi
  const response = await fetch('https://gate.whapi.cloud/messages/list?count=20', {
    headers: { 'Authorization': 'Bearer OOClA5RhCo9i5YfkNhvRO5OsqzmKMQ3x' }
  });
  const data = await response.json();

  // Group messages by chat_id
  const chatMessages = {};
  for (const msg of data.messages) {
    if (!chatMessages[msg.chat_id]) {
      chatMessages[msg.chat_id] = [];
    }
    chatMessages[msg.chat_id].push(msg);
  }

  console.log('Found', Object.keys(chatMessages).length, 'unique chats');

  // Create chats and import messages
  for (const [waChatId, messages] of Object.entries(chatMessages)) {
    // Get contact name from first message
    const firstMsg = messages[0];
    const contactPhone = waChatId.split('@')[0];
    const contactName = firstMsg.from_name || contactPhone;
    const lastMsg = messages[0]; // Most recent

    // Create chat
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .upsert({
        channel_id: channelId,
        workspace_id: workspaceId,
        wa_chat_id: waChatId,
        phone_number: contactPhone,
        display_name: contactName,
        is_group: waChatId.includes('@g.us'),
        last_message_preview: lastMsg.text?.body || '[media]',
        last_message_at: new Date(lastMsg.timestamp * 1000).toISOString(),
        unread_count: messages.filter(m => !m.from_me).length
      }, { onConflict: 'channel_id,wa_chat_id' })
      .select()
      .single();

    if (chatError) {
      console.error('Chat error:', chatError.message);
      continue;
    }

    console.log('Created chat:', chat.id, 'for', contactName);

    // Import messages
    for (const msg of messages) {
      const { error: msgError } = await supabase
        .from('messages')
        .upsert({
          chat_id: chat.id,
          channel_id: channelId,
          workspace_id: workspaceId,
          wa_message_id: msg.id,
          direction: msg.from_me ? 'outbound' : 'inbound',
          message_type: msg.type,
          text: msg.text?.body || null,
          status: msg.from_me ? (msg.status || 'sent') : null,
          created_at: new Date(msg.timestamp * 1000).toISOString()
        }, { onConflict: 'channel_id,wa_message_id' });

      if (msgError) {
        console.error('Message error:', msgError.message);
      }
    }
    console.log('Imported', messages.length, 'messages for chat', chat.id);
  }

  console.log('Done!');
}

importMessages();
