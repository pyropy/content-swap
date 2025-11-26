import './Tabs.css';

export type TabId = 'catalog' | 'purchased' | 'logs' | 'channel-setup' | 'settings';

interface TabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabs: { id: TabId; label: string }[] = [
  { id: 'catalog', label: 'Catalog' },
  { id: 'purchased', label: 'Purchased' },
  { id: 'logs', label: 'Activity Log' },
  { id: 'channel-setup', label: 'Channel Setup' },
  { id: 'settings', label: 'Settings' },
];

export function Tabs({ activeTab, onTabChange }: TabsProps) {
  return (
    <div className="tabs">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
