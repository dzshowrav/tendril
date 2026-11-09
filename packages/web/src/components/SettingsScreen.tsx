import React, { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { ApiClient } from '../api/client.js';
import { useAuthStore } from '../store/auth-store.js';

type SettingsTab = 'providers' | 'permissions' | 'clients' | 'about';

interface ProviderItem {
  id: string;
  type: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  maskedKey: string;
}

interface RuleItem {
  id: string;
  workspace_path: string;
  tool: string;
  pattern: string;
  decision: 'allow' | 'deny';
  created_at: string;
}

interface ClientItem {
  id: string;
  label: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

interface DoctorCheckResult {
  id: string;
  title: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

export const SettingsScreen: React.FC = () => {
  const [, navigate] = useLocation();
  const { currentClientId, logout } = useAuthStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');

  // Providers state
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [newProviderId, setNewProviderId] = useState('');
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderType, setNewProviderType] = useState<'anthropic' | 'openai-compatible'>('openai-compatible');
  const [newProviderBaseUrl, setNewProviderBaseUrl] = useState('');
  const [newProviderKey, setNewProviderKey] = useState('');
  const [showAddProvider, setShowAddProvider] = useState(false);

  // Config & Permissions state
  const [defaultMode, setDefaultMode] = useState<string>('ask');
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);

  // Clients state
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);

  // Doctor state
  const [doctorResults, setDoctorResults] = useState<DoctorCheckResult[] | null>(null);
  const [runningDoctor, setRunningDoctor] = useState(false);

  // Fetch Providers
  const fetchProviders = useCallback(async () => {
    setLoadingProviders(true);
    try {
      const res = await ApiClient.getProviders();
      setProviders(res.providers || []);
    } catch {
      // ignore
    } finally {
      setLoadingProviders(false);
    }
  }, []);

  // Fetch Config & Rules
  const fetchConfigAndRules = useCallback(async () => {
    setLoadingRules(true);
    try {
      const [cfgRes, rulesRes] = await Promise.all([
        ApiClient.getConfig(),
        ApiClient.getRules(),
      ]);
      setDefaultMode(cfgRes.config?.default_mode || 'ask');
      setRules(rulesRes.rules || []);
    } catch {
      // ignore
    } finally {
      setLoadingRules(false);
    }
  }, []);

  // Fetch Clients
  const fetchClients = useCallback(async () => {
    setLoadingClients(true);
    try {
      const res = await ApiClient.getClients();
      setClients(res.clients || []);
    } catch {
      // ignore
    } finally {
      setLoadingClients(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'providers') fetchProviders();
    else if (activeTab === 'permissions') fetchConfigAndRules();
    else if (activeTab === 'clients') fetchClients();
  }, [activeTab, fetchProviders, fetchConfigAndRules, fetchClients]);

  // Handle Provider Save
  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProviderId.trim()) return;

    try {
      await ApiClient.updateProvider(newProviderId.trim(), {
        name: newProviderName.trim() || newProviderId.trim(),
        type: newProviderType,
        baseUrl: newProviderBaseUrl.trim() || undefined,
        apiKey: newProviderKey.trim() || undefined,
      });
      setNewProviderId('');
      setNewProviderName('');
      setNewProviderBaseUrl('');
      setNewProviderKey('');
      setShowAddProvider(false);
      fetchProviders();
    } catch (err: any) {
      alert(err?.message || 'Failed to save provider');
    }
  };

  const handleDeleteProvider = async (id: string) => {
    if (!confirm(`Delete provider '${id}'?`)) return;
    try {
      await ApiClient.deleteProvider(id);
      fetchProviders();
    } catch (err: any) {
      alert(err?.message || 'Failed to delete provider');
    }
  };

  const handleTestProvider = async (id: string) => {
    setTestResult((prev) => ({ ...prev, [id]: 'Testing...' }));
    try {
      const res = await ApiClient.testProvider(id);
      setTestResult((prev) => ({ ...prev, [id]: `✓ ${res.message}` }));
    } catch (err: any) {
      setTestResult((prev) => ({ ...prev, [id]: `✕ ${err?.message || 'Failed'}` }));
    }
  };

  // Handle Default Mode Change
  const handleModeChange = async (mode: string) => {
    setDefaultMode(mode);
    try {
      await ApiClient.updateConfig({ default_mode: mode });
    } catch (err: any) {
      alert(err?.message || 'Failed to update default mode');
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await ApiClient.deleteRule(id);
      fetchConfigAndRules();
    } catch (err: any) {
      alert(err?.message || 'Failed to delete rule');
    }
  };

  // Handle Revoke Client
  const handleRevokeClient = async (id: string) => {
    if (!confirm('Revoke this paired client?')) return;
    try {
      await ApiClient.deleteClient(id);
      // If revoking current client, logout immediately and land on /pair
      if (id === currentClientId) {
        await logout();
        navigate('/pair');
        return;
      }
      fetchClients();
    } catch (err: any) {
      alert(err?.message || 'Failed to revoke client');
    }
  };

  // Handle Run Doctor
  const handleRunDoctor = async () => {
    setRunningDoctor(true);
    try {
      const res = await ApiClient.getDoctor();
      setDoctorResults(res.results?.checks || res.results || []);
    } catch (err: any) {
      alert(err?.message || 'Failed to run doctor');
    } finally {
      setRunningDoctor(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg)',
        overflowY: 'auto',
      }}
    >
      {/* Settings Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          backgroundColor: 'var(--surface)',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {(['providers', 'permissions', 'clients', 'about'] as SettingsTab[]).map((tab) => {
          const isActive = activeTab === tab;
          const label = tab.charAt(0).toUpperCase() + tab.slice(1);
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '12px 14px',
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                color: isActive ? 'var(--primary)' : 'var(--muted)',
                fontWeight: isActive ? 700 : 500,
                fontSize: 13,
                minHeight: 48,
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, padding: 16 }}>
        {/* TAB 1: PROVIDERS */}
        {activeTab === 'providers' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>AI Providers</h3>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>Configured API keys and models</p>
              </div>
              <button
                onClick={() => setShowAddProvider(!showAddProvider)}
                style={{
                  padding: '8px 14px',
                  backgroundColor: 'var(--primary)',
                  color: 'var(--on-primary)',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 12,
                  minHeight: 40,
                }}
              >
                {showAddProvider ? 'Cancel' : '+ Add Provider'}
              </button>
            </div>

            {showAddProvider && (
              <form
                onSubmit={handleSaveProvider}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  padding: 16,
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>New Provider</div>
                <input
                  type="text"
                  placeholder="Provider ID (e.g. deepseek, custom-ollama)"
                  value={newProviderId}
                  onChange={(e) => setNewProviderId(e.target.value)}
                  required
                  style={{
                    padding: 10,
                    backgroundColor: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text)',
                    fontSize: 13,
                  }}
                />
                <input
                  type="text"
                  placeholder="Display Name"
                  value={newProviderName}
                  onChange={(e) => setNewProviderName(e.target.value)}
                  style={{
                    padding: 10,
                    backgroundColor: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text)',
                    fontSize: 13,
                  }}
                />
                <select
                  value={newProviderType}
                  onChange={(e) => setNewProviderType(e.target.value as any)}
                  style={{
                    padding: 10,
                    backgroundColor: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text)',
                    fontSize: 13,
                  }}
                >
                  <option value="openai-compatible">OpenAI-Compatible</option>
                  <option value="anthropic">Anthropic</option>
                </select>
                <input
                  type="text"
                  placeholder="Base URL (optional, e.g. https://api.deepseek.com/v1)"
                  value={newProviderBaseUrl}
                  onChange={(e) => setNewProviderBaseUrl(e.target.value)}
                  style={{
                    padding: 10,
                    backgroundColor: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text)',
                    fontSize: 13,
                  }}
                />
                <input
                  type="password"
                  placeholder="API Key"
                  value={newProviderKey}
                  onChange={(e) => setNewProviderKey(e.target.value)}
                  style={{
                    padding: 10,
                    backgroundColor: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text)',
                    fontSize: 13,
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: 10,
                    backgroundColor: 'var(--primary)',
                    color: 'var(--on-primary)',
                    border: 'none',
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: 13,
                    minHeight: 44,
                    marginTop: 6,
                  }}
                >
                  Save Provider
                </button>
              </form>
            )}

            {loadingProviders ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>Loading providers...</div>
            ) : providers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>
                No providers configured. Click + Add Provider to configure one.
              </div>
            ) : (
              providers.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: 12,
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                        ({p.id})
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleTestProvider(p.id)}
                        style={{
                          padding: '4px 10px',
                          backgroundColor: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          fontSize: 11,
                          color: 'var(--text)',
                          minHeight: 32,
                        }}
                      >
                        Test
                      </button>
                      <button
                        onClick={() => handleDeleteProvider(p.id)}
                        style={{
                          padding: '4px 10px',
                          backgroundColor: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          fontSize: 11,
                          color: 'var(--error)',
                          minHeight: 32,
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div>Key: <span style={{ fontFamily: 'var(--font-mono)' }}>{p.maskedKey || '(none)'}</span></div>
                    {p.baseUrl && <div>Base URL: <span style={{ fontFamily: 'var(--font-mono)' }}>{p.baseUrl}</span></div>}
                    {testResult[p.id] && (
                      <div style={{ color: testResult[p.id].startsWith('✓') ? 'var(--primary)' : 'var(--warning)', marginTop: 4 }}>
                        {testResult[p.id]}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 2: PERMISSIONS & DEFAULTS */}
        {activeTab === 'permissions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: 14, backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Default Session Mode</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['ask', 'plan', 'code', 'auto'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => handleModeChange(mode)}
                    style={{
                      flex: 1,
                      minWidth: 70,
                      padding: '8px 12px',
                      backgroundColor: defaultMode === mode ? 'var(--primary)' : 'var(--surface-2)',
                      color: defaultMode === mode ? 'var(--on-primary)' : 'var(--text)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      minHeight: 40,
                    }}
                  >
                    {mode.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                Saved Permission Rules
              </h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                Rules created with "Always Allow" in permission prompts
              </p>

              {loadingRules ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>Loading rules...</div>
              ) : rules.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>
                  No saved permission rules.
                </div>
              ) : (
                rules.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 12,
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      marginBottom: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>
                        {r.tool}: {r.pattern}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        Workspace: {r.workspace_path}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteRule(r.id)}
                      style={{
                        padding: '4px 10px',
                        backgroundColor: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        color: 'var(--error)',
                        borderRadius: 4,
                        fontSize: 11,
                        minHeight: 32,
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: CLIENTS */}
        {activeTab === 'clients' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Paired Web Devices</h3>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>Active browser connections and tokens</p>
            </div>

            {loadingClients ? (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>Loading clients...</div>
            ) : clients.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>
                No paired clients found.
              </div>
            ) : (
              clients.map((c) => {
                const isCurrent = c.id === currentClientId;
                const isRevoked = Boolean(c.revoked_at);

                return (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 12,
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{c.label || 'Web Client'}</span>
                        {isCurrent && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: '2px 6px',
                              backgroundColor: 'rgba(61, 220, 151, 0.2)',
                              color: 'var(--primary)',
                              borderRadius: 4,
                            }}
                          >
                            This Device
                          </span>
                        )}
                        {isRevoked && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: '2px 6px',
                              backgroundColor: 'var(--surface-2)',
                              color: 'var(--muted)',
                              borderRadius: 4,
                            }}
                          >
                            Revoked
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                        ID: {c.id.slice(0, 8)}... • Paired {new Date(c.created_at).toLocaleDateString()}
                      </div>
                    </div>

                    {!isRevoked && (
                      <button
                        onClick={() => handleRevokeClient(c.id)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          color: 'var(--error)',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          minHeight: 36,
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 4: ABOUT & DOCTOR */}
        {activeTab === 'about' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: 16, backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--primary)' }}>Tendril v0.1.0</h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                The open-source AI coding harness for Termux on Android.
              </p>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700 }}>System Health & Diagnostics</h4>
                <button
                  onClick={handleRunDoctor}
                  disabled={runningDoctor}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    borderRadius: 6,
                    fontWeight: 600,
                    fontSize: 12,
                    minHeight: 40,
                  }}
                >
                  {runningDoctor ? 'Running Doctor...' : 'Run Doctor'}
                </button>
              </div>

              {doctorResults && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {doctorResults.map((check) => {
                    const statusLower = (check.status || '').toLowerCase();
                    const isPass = statusLower === 'pass';
                    const isWarn = statusLower === 'warn';
                    const badgeColor = isPass ? 'var(--primary)' : isWarn ? 'var(--warning)' : 'var(--error)';

                    return (
                      <div
                        key={check.id}
                        style={{
                          padding: 12,
                          backgroundColor: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{check.title || check.id}</span>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: badgeColor,
                              textTransform: 'uppercase',
                            }}
                          >
                            {check.status}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                          {check.message}
                        </div>
                        {check.fix && (
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 11,
                              color: 'var(--secondary)',
                              fontFamily: 'var(--font-mono)',
                              backgroundColor: 'var(--surface-2)',
                              padding: '4px 8px',
                              borderRadius: 4,
                            }}
                          >
                            Fix: {check.fix}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
