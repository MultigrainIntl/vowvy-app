import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import AuthScreen from './AuthScreen';
import MainScreen from './MainScreen';
import ContainerScreen from './ContainerScreen';
import AcceptInviteScreen from './AcceptInviteScreen';
import TrashScreen from './TrashScreen';
import ManageScreen from './ManageScreen';
import CollaboratorDashboard from './CollaboratorDashboard';
import ClaimBoxScreen from './ClaimBoxScreen';
import ProfileScreen from './ProfileScreen';
import AdminScreen from './AdminScreen';
import './App.css';

interface Route {
  type: 'home' | 'container' | 'invite' | 'trash' | 'manage' | 'collaborators' | 'box' | 'profile' | 'admin';
  id: string | null;
  owner: string | null;
}

function parsePath(): Route {
  const p = window.location.pathname;
  if (p === '/trash') return { type: 'trash', id: null, owner: null };
  if (p === '/manage') return { type: 'manage', id: null, owner: null };
  if (p === '/collaborators') return { type: 'collaborators', id: null, owner: null };
  if (p === '/profile') return { type: 'profile', id: null, owner: null };
  if (p === '/admin') return { type: 'admin', id: null, owner: null };
  const container = p.match(/^\/container\/([^/]+)$/);
  if (container) return { type: 'container', id: container[1], owner: null };
  const invite = p.match(/^\/invite\/([^/]+)$/);
  if (invite) return { type: 'invite', id: invite[1], owner: null };
  const box = p.match(/^\/box\/([^/]+)$/);
  if (box) return { type: 'box', id: box[1], owner: null };
  return { type: 'home', id: null, owner: new URLSearchParams(window.location.search).get('owner') };
}

export default function App() {
  const [user, setUser]     = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute]   = useState<Route>(parsePath);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parsePath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (loading) return null;

  // Preserve invite token through sign-in: store token before auth, restore after
  if (!user) {
    if (route.type === 'invite' && route.id) {
      sessionStorage.setItem('pendingInviteToken', route.id);
    }
    return <AuthScreen />;
  }

  // After sign-in, check for a pending invite token
  const pendingToken = sessionStorage.getItem('pendingInviteToken');
  if (pendingToken && route.type !== 'invite') {
    sessionStorage.removeItem('pendingInviteToken');
    return <AcceptInviteScreen user={user} token={pendingToken} />;
  }

  if (route.type === 'invite' && route.id) {
    return <AcceptInviteScreen user={user} token={route.id} />;
  }
  if (route.type === 'trash') {
    return <TrashScreen user={user} />;
  }
  if (route.type === 'manage') {
    return <ManageScreen user={user} />;
  }
  if (route.type === 'collaborators') {
    return <CollaboratorDashboard user={user} />;
  }
  if (route.type === 'profile') {
    return <ProfileScreen user={user} />;
  }
  if (route.type === 'admin') {
    if (user.email !== 'george@multigrain.com') return <MainScreen user={user} initialOwnerUid={route.owner} />;
    return <AdminScreen user={user} />;
  }
  if (route.type === 'container' && route.id) {
    return <ContainerScreen user={user} containerId={route.id} />;
  }
  if (route.type === 'box' && route.id) {
    return <ClaimBoxScreen user={user} boxId={route.id} />;
  }
  return <MainScreen user={user} initialOwnerUid={route.owner} />;
}
