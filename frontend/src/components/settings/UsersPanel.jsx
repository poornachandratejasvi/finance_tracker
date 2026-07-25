import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Paper, Typography, Button, IconButton, Alert, Avatar, Chip, Tooltip,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, FormControlLabel, Switch, CircularProgress, Stack,
} from '@mui/material';
import {
  Add, Edit, Delete, PersonAddAlt1, PhotoCamera, Lock,
} from '@mui/icons-material';
import { getUsers, createUser, updateUser, deleteUser } from '../../services/api';
import { formatDate } from '../../utils/format';
import { useAuth } from '../../contexts/AuthContext';

const ROLES = ['ADMIN', 'USER', 'VIEWER'];

// MUI chip color per role (green theme uses primary for admins).
const roleColor = (role) => {
  switch ((role || '').toUpperCase()) {
    case 'ADMIN': return 'primary';
    case 'VIEWER': return 'warning';
    default: return 'default';
  }
};

// Two-letter initials from a name/username for the fallback avatar.
const initials = (u) => {
  const src = (u?.full_name || u?.username || u?.email || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
};

// Read a picked image file, draw it onto a canvas scaled so its longest edge is
// ~maxSize px, and return a JPEG data URL. Keeps stored avatars small.
const resizeImageToDataUrl = (file, maxSize = 256) =>
  new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No file')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch (e) {
          reject(e);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

const emptyCreate = { username: '', email: '', full_name: '', password: '', role: 'USER' };

export default function UsersPanel() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add-user dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyCreate);
  const [addSaving, setAddSaving] = useState(false);

  // Edit-user dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef(null);

  // Delete confirm dialog
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setForbidden(false);
    try {
      const data = await getUsers();
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e?.response?.status === 403) {
        setForbidden(true);
      } else {
        setError(e?.response?.data?.detail || 'Failed to load users');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const apiError = (e, fallback) => {
    const detail = e?.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (detail) return JSON.stringify(detail);
    return fallback;
  };

  // ----- Add -----
  const openAdd = () => { setAddForm(emptyCreate); setError(''); setSuccess(''); setAddOpen(true); };
  const submitAdd = async () => {
    setAddSaving(true);
    setError('');
    try {
      await createUser({
        username: addForm.username.trim(),
        email: addForm.email.trim(),
        full_name: addForm.full_name.trim() || null,
        password: addForm.password,
        role: addForm.role,
      });
      setSuccess(`User "${addForm.username.trim()}" created.`);
      setAddOpen(false);
      await load();
    } catch (e) {
      setError(apiError(e, 'Failed to create user'));
    } finally {
      setAddSaving(false);
    }
  };
  const addValid =
    addForm.username.trim().length >= 3 &&
    /\S+@\S+\.\S+/.test(addForm.email) &&
    (addForm.password || '').length >= 8;

  // ----- Edit -----
  const openEdit = (u) => {
    setEditUser(u);
    setEditForm({
      email: u.email || '',
      full_name: u.full_name || '',
      role: (u.role || 'USER').toUpperCase(),
      is_active: !!u.is_active,
      password: '',
      avatar_url: u.avatar_url || '',
    });
    setError('');
    setSuccess('');
    setEditOpen(true);
  };
  const submitEdit = async () => {
    if (!editUser) return;
    setEditSaving(true);
    setError('');
    try {
      const payload = {
        email: editForm.email.trim(),
        full_name: editForm.full_name.trim() || null,
        role: editForm.role,
        is_active: editForm.is_active,
        avatar_url: editForm.avatar_url || null,
      };
      if (editForm.password) payload.password = editForm.password;
      await updateUser(editUser.id, payload);
      setSuccess(`User "${editUser.username}" updated.`);
      setEditOpen(false);
      await load();
    } catch (e) {
      setError(apiError(e, 'Failed to update user'));
    } finally {
      setEditSaving(false);
    }
  };

  const onPickAvatar = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (fileRef.current) fileRef.current.value = ''; // allow re-picking same file
    if (!file) return;
    setAvatarBusy(true);
    setError('');
    try {
      const dataUrl = await resizeImageToDataUrl(file, 256);
      setEditForm((f) => ({ ...f, avatar_url: dataUrl }));
    } catch (err) {
      setError('Could not process image. Try a different photo.');
    } finally {
      setAvatarBusy(false);
    }
  };

  // ----- Delete -----
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setError('');
    try {
      await deleteUser(deleteTarget.id);
      setSuccess(`User "${deleteTarget.username}" deleted.`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(apiError(e, 'Failed to delete user'));
    } finally {
      setDeleteBusy(false);
    }
  };

  if (forbidden) {
    return (
      <Box sx={{ p: 1 }}>
        <Alert severity="warning">
          Administrator access required. Ask an admin to manage users, or sign in with an
          administrator account.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h6">Users</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage accounts, roles and access.
          </Typography>
        </Box>
        <Button variant="contained" color="primary" startIcon={<PersonAddAlt1 />} onClick={openAdd}>
          Add user
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Full name</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      No users found.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : users.map((u) => {
                const isSelf = currentUser && u.id === currentUser.id;
                return (
                  <TableRow key={u.id} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Avatar
                          src={u.avatar_url || undefined}
                          sx={{ width: 36, height: 36, bgcolor: 'primary.main', fontSize: 14 }}
                        >
                          {initials(u)}
                        </Avatar>
                        <Box>
                          <Typography variant="body2" component="div" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                            {u.username}{isSelf && <Chip label="you" size="small" sx={{ ml: 1, height: 18 }} />}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Joined {formatDate(u.created_at)}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{u.full_name || '—'}</TableCell>
                    <TableCell>
                      <Chip label={(u.role || 'USER').toUpperCase()} size="small" color={roleColor(u.role)} variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={u.is_active ? 'Active' : 'Inactive'}
                        size="small"
                        color={u.is_active ? 'success' : 'default'}
                        variant={u.is_active ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit user">
                        <IconButton size="small" onClick={() => openEdit(u)}>
                          <Edit fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={isSelf ? 'You cannot delete your own account' : 'Delete user'}>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={isSelf}
                            onClick={() => setDeleteTarget(u)}
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Add user dialog */}
      <Dialog open={addOpen} onClose={() => !addSaving && setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add user</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              label="Username" value={addForm.username} required autoFocus
              onChange={(e) => setAddForm((f) => ({ ...f, username: e.target.value }))}
              helperText="At least 3 characters"
            />
            <TextField
              label="Email" type="email" value={addForm.email} required
              onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
            />
            <TextField
              label="Full name" value={addForm.full_name}
              onChange={(e) => setAddForm((f) => ({ ...f, full_name: e.target.value }))}
            />
            <TextField
              label="Password" type="password" value={addForm.password} required
              onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
              helperText="At least 8 characters"
            />
            <TextField
              label="Role" select value={addForm.role}
              onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}
            >
              {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)} disabled={addSaving}>Cancel</Button>
          <Button
            variant="contained" onClick={submitAdd} disabled={!addValid || addSaving}
            startIcon={addSaving ? <CircularProgress size={16} color="inherit" /> : <Add />}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit user dialog */}
      <Dialog open={editOpen} onClose={() => !editSaving && setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit {editUser?.username}</DialogTitle>
        <DialogContent dividers>
          {editForm && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar
                  src={editForm.avatar_url || undefined}
                  sx={{ width: 64, height: 64, bgcolor: 'primary.main', fontSize: 22 }}
                >
                  {initials(editUser)}
                </Avatar>
                <Box>
                  <input
                    ref={fileRef} type="file" accept="image/*" hidden onChange={onPickAvatar}
                  />
                  <Button
                    variant="outlined" size="small" startIcon={<PhotoCamera />}
                    disabled={avatarBusy} onClick={() => fileRef.current && fileRef.current.click()}
                  >
                    {avatarBusy ? 'Processing…' : 'Upload photo'}
                  </Button>
                  {editForm.avatar_url && (
                    <Button
                      size="small" color="error" sx={{ ml: 1 }}
                      onClick={() => setEditForm((f) => ({ ...f, avatar_url: '' }))}
                    >
                      Remove
                    </Button>
                  )}
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    Resized to ~256px and stored inline.
                  </Typography>
                </Box>
              </Box>

              <TextField
                label="Email" type="email" value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              />
              <TextField
                label="Full name" value={editForm.full_name}
                onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
              />
              <TextField
                label="Role" select value={editForm.role}
                onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
              >
                {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
              </TextField>
              <FormControlLabel
                control={
                  <Switch
                    checked={editForm.is_active}
                    onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))}
                  />
                }
                label="Active"
              />
              <TextField
                label="New password (optional)" type="password" value={editForm.password}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                InputProps={{ startAdornment: <Lock fontSize="small" sx={{ mr: 1, color: 'text.disabled' }} /> }}
                helperText="Leave blank to keep the current password. Minimum 8 characters."
                error={!!editForm.password && editForm.password.length < 8}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)} disabled={editSaving}>Cancel</Button>
          <Button
            variant="contained" onClick={submitEdit}
            disabled={editSaving || (!!editForm?.password && editForm.password.length < 8)}
            startIcon={editSaving ? <CircularProgress size={16} color="inherit" /> : <Edit />}
          >
            Save changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onClose={() => !deleteBusy && setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete user</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Delete <strong>{deleteTarget?.username}</strong>? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Cancel</Button>
          <Button
            variant="contained" color="error" onClick={confirmDelete} disabled={deleteBusy}
            startIcon={deleteBusy ? <CircularProgress size={16} color="inherit" /> : <Delete />}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
