import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container, Typography, Paper, Box, Button, TextField, CircularProgress,
  Chip, Divider, Alert, Link,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import PersonIcon from '@mui/icons-material/Person';
import SendIcon from '@mui/icons-material/Send';
import { aiQuery } from '../services/api';

const EXAMPLES = [
  'How much did I spend on Food last month?',
  'What are my biggest expenses?',
  'Any unusual transactions recently?',
  'How does this month compare to last month?',
];

export default function AskAI() {
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [thread, setThread] = useState([]); // [{ q, a, ai }]
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const ask = async (text) => {
    const q = (text != null ? text : question).trim();
    if (!q || loading) return;
    setErr('');
    setLoading(true);
    setQuestion('');
    try {
      const res = await aiQuery(q);
      const answer = (res && res.answer) || 'No answer returned.';
      const ai = !(res && res.ai === false);
      setThread((prev) => [{ q, a: answer, ai }, ...prev]);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setThread((prev) => [{ q, a: typeof detail === 'string' ? detail : 'Something went wrong while asking the AI. Please try again.', ai: true, error: true }, ...prev]);
      setErr('Failed to get an answer. Check your AI configuration in Settings.');
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => {
    // Enter to send, Shift+Enter for a newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <AutoAwesomeIcon color="primary" />
        <Typography variant="h4">Ask AI</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Ask questions about your transactions, spending, and finances in plain English.
      </Typography>

      {/* Composer */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={8}
          placeholder="Ask anything about your finances…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1.5, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Press Enter to send · Shift+Enter for a new line
          </Typography>
          <Button
            variant="contained"
            onClick={() => ask()}
            disabled={loading || !question.trim()}
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
          >
            {loading ? 'Thinking…' : 'Ask'}
          </Button>
        </Box>
      </Paper>

      {/* Example questions */}
      {thread.length === 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            Try one of these
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {EXAMPLES.map((ex) => (
              <Chip
                key={ex}
                label={ex}
                onClick={() => ask(ex)}
                disabled={loading}
                clickable
                variant="outlined"
                color="primary"
              />
            ))}
          </Box>
        </Box>
      )}

      {err && <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}

      {/* Loading placeholder for the pending question */}
      {loading && (
        <Paper sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">Thinking…</Typography>
        </Paper>
      )}

      {/* Conversation thread (most recent first) */}
      {thread.map((item, idx) => (
        <Paper key={thread.length - idx} sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <PersonIcon fontSize="small" color="action" sx={{ mt: 0.3 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
              {item.q}
            </Typography>
          </Box>
          <Divider sx={{ my: 1.5 }} />
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <AutoAwesomeIcon fontSize="small" color={item.error ? 'error' : 'primary'} sx={{ mt: 0.3 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="body1"
                component="div"
                sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                color={item.error ? 'error' : 'text.primary'}
              >
                {item.a}
              </Typography>
              {item.ai === false && (
                <Alert severity="info" sx={{ mt: 1.5 }}>
                  This is a basic answer. For smarter responses,{' '}
                  <Link
                    component="button"
                    type="button"
                    onClick={() => navigate('/settings')}
                    sx={{ verticalAlign: 'baseline' }}
                  >
                    configure an AI provider in Settings → AI
                  </Link>
                  .
                </Alert>
              )}
            </Box>
          </Box>
        </Paper>
      ))}
    </Container>
  );
}
