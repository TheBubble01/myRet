import { Retirement, DailyRecord, SupplementaryEntry, ActivityLog, UserProfile } from '../types';
import { calculateAmount } from './currency';

export const DEMO_USER: UserProfile = {
  id: 'usr-demo-001',
  name: 'Mubarak Jibril Dederi',
  designation: 'Site Construction Engineer',
  phone: '+234 803 456 7890',
  email: 'elmubaraq69@gmail.com',
  placement: 'Borno State Specialist Hospital Renovation - Phase II',
};

export const SUPERVISOR_USER: UserProfile = {
  id: 'usr-sup-002',
  name: 'Engr. Aliyu Sanusi, FNSE',
  designation: 'Project Director & Lead Auditor',
  phone: '+234 802 987 6543',
  email: 'auditor.sanusi@conbuild.ng',
  placement: 'Borno State Specialist Hospital Renovation - Phase II',
};

export function createDemoRetirement(): {
  retirement: Retirement;
  dailyRecords: DailyRecord[];
  supplementary: SupplementaryEntry[];
  logs: ActivityLog[];
} {
  const retirementId = 'ret-demo-001';

  const dailyRecords: DailyRecord[] = [
    {
      id: 'rec-01',
      retirementId,
      date: '2026-10-01',
      categories: [
        {
          id: 'cat-01-excavation',
          name: 'Excavation',
          items: [
            {
              id: 'item-01-1',
              description: 'Excavator labour',
              quantity: 2,
              rate: 20000,
              amount: calculateAmount(2, 20000),
            },
            {
              id: 'item-01-2',
              description: 'Labourers',
              quantity: 8,
              rate: 4000,
              amount: calculateAmount(8, 4000),
            },
          ],
          subtotal: 72000,
        },
        {
          id: 'cat-01-supply',
          name: 'Supply',
          items: [
            {
              id: 'item-01-3',
              description: 'Timber for setting out profile',
              quantity: 15,
              rate: 4500,
              amount: calculateAmount(15, 4500),
            },
            {
              id: 'item-01-4',
              description: 'Profile pegs & survey lines',
              quantity: 1,
              rate: 12500,
              amount: calculateAmount(1, 12500),
            },
          ],
          subtotal: 80000,
        },
      ],
      dailyTotal: 152000,
      createdAt: '2026-10-01T17:30:00.000Z',
      updatedAt: '2026-10-01T17:30:00.000Z',
      syncStatus: 'synced',
    },
    {
      id: 'rec-02',
      retirementId,
      date: '2026-10-03',
      categories: [
        {
          id: 'cat-02-casting',
          name: 'Casting',
          items: [
            {
              id: 'item-02-1',
              description: 'Dangote Cement 42.5R (bags)',
              quantity: 80,
              rate: 8500,
              amount: calculateAmount(80, 8500),
            },
            {
              id: 'item-02-2',
              description: 'Sharp Sand (trips)',
              quantity: 2,
              rate: 45000,
              amount: calculateAmount(2, 45000),
            },
            {
              id: 'item-02-3',
              description: 'Granite 3/4 aggregate (trips)',
              quantity: 3,
              rate: 65000,
              amount: calculateAmount(3, 65000),
            },
            {
              id: 'item-02-4',
              description: 'Mixer machine hire & diesel',
              quantity: 1,
              rate: 35000,
              amount: calculateAmount(1, 35000),
            },
            {
              id: 'item-02-5',
              description: 'Casting gang labour',
              quantity: 14,
              rate: 4500,
              amount: calculateAmount(14, 4500),
            },
          ],
          subtotal: 1063000,
        },
      ],
      dailyTotal: 1063000,
      createdAt: '2026-10-03T18:15:00.000Z',
      updatedAt: '2026-10-03T18:15:00.000Z',
      syncStatus: 'synced',
    },
    {
      id: 'rec-03',
      retirementId,
      date: '2026-10-05',
      categories: [
        {
          id: 'cat-03-excavation',
          name: 'Excavation',
          items: [
            {
              id: 'item-03-1',
              description: 'Excavator labour',
              quantity: 2,
              rate: 20000,
              amount: calculateAmount(2, 20000),
            },
            {
              id: 'item-03-2',
              description: 'Labourers',
              quantity: 8,
              rate: 4000,
              amount: calculateAmount(8, 4000),
            },
          ],
          subtotal: 72000,
        },
        {
          id: 'cat-03-blockwork',
          name: 'Blockwork',
          items: [
            {
              id: 'item-03-3',
              description: 'Mason',
              quantity: 10,
              rate: 7000,
              amount: calculateAmount(10, 7000),
            },
            {
              id: 'item-03-4',
              description: 'Labourers',
              quantity: 10,
              rate: 4000,
              amount: calculateAmount(10, 4000),
            },
            {
              id: 'item-03-5',
              description: 'Counting',
              quantity: 512,
              rate: 85,
              amount: calculateAmount(512, 85),
            },
          ],
          subtotal: 153520,
        },
        {
          id: 'cat-03-supply',
          name: 'Supply',
          items: [
            {
              id: 'item-03-6',
              description: 'Timber',
              quantity: 20,
              rate: 8000,
              amount: calculateAmount(20, 8000),
            },
          ],
          subtotal: 160000,
        },
        {
          id: 'cat-03-other',
          name: 'Other Works',
          items: [
            {
              id: 'item-03-7',
              description: 'Water tanker bowser delivery',
              quantity: 2,
              rate: 15000,
              amount: calculateAmount(2, 15000),
            },
          ],
          subtotal: 30000,
        },
      ],
      dailyTotal: 415520,
      createdAt: '2026-10-05T19:00:00.000Z',
      updatedAt: '2026-10-05T19:00:00.000Z',
      syncStatus: 'synced',
    },
  ];

  const supplementary: SupplementaryEntry[] = [
    {
      id: 'supp-01',
      retirementId,
      description: 'Payment for additional binding wire & special hardener',
      amount: 50000,
      createdAt: '2026-10-04T12:00:00.000Z',
      syncStatus: 'synced',
    },
    {
      id: 'supp-02',
      retirementId,
      description: 'Emergency site pump transport & mechanical fix',
      amount: 15000,
      createdAt: '2026-10-05T15:20:00.000Z',
      syncStatus: 'synced',
    },
  ];

  const logs: ActivityLog[] = [
    {
      id: 'log-1',
      retirementId,
      userId: DEMO_USER.id,
      userName: DEMO_USER.name,
      action: 'Retirement Created',
      details: 'Created retirement RET-7K4M2P for Block B Substructure',
      timestamp: '2026-10-01T08:00:00.000Z',
    },
    {
      id: 'log-2',
      retirementId,
      userId: DEMO_USER.id,
      userName: DEMO_USER.name,
      action: 'Daily Record Created',
      details: 'Recorded 01/10/2026 expenditures (₦152,000)',
      timestamp: '2026-10-01T17:35:00.000Z',
    },
    {
      id: 'log-3',
      retirementId,
      userId: DEMO_USER.id,
      userName: DEMO_USER.name,
      action: 'Daily Record Created',
      details: 'Recorded 03/10/2026 Casting expenditures (₦1,063,000)',
      timestamp: '2026-10-03T18:20:00.000Z',
    },
    {
      id: 'log-4',
      retirementId,
      userId: DEMO_USER.id,
      userName: DEMO_USER.name,
      action: 'Supplementary Added',
      details: 'Added supplementary: Binding wire (₦50,000)',
      timestamp: '2026-10-04T12:05:00.000Z',
    },
    {
      id: 'log-5',
      retirementId,
      userId: DEMO_USER.id,
      userName: DEMO_USER.name,
      action: 'Daily Record Created',
      details: 'Recorded 05/10/2026 Blockwork & Supply (₦415,520)',
      timestamp: '2026-10-05T19:05:00.000Z',
    },
  ];

  const retirement: Retirement = {
    id: retirementId,
    code: 'RET-7K4M2P',
    title: 'Block B Substructure & Ground Floor Casting',
    project: 'Borno State Specialist Hospital Renovation - Phase II',
    ownerId: DEMO_USER.id,
    ownerName: DEMO_USER.name,
    ownerDesignation: DEMO_USER.designation,
    ownerPhone: DEMO_USER.phone,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-05T19:05:00.000Z',
    status: 'active',
    access: [
      {
        userId: DEMO_USER.id,
        userEmail: DEMO_USER.email,
        userName: DEMO_USER.name,
        role: 'OWNER',
        grantedAt: '2026-10-01T08:00:00.000Z',
      },
      {
        userId: SUPERVISOR_USER.id,
        userEmail: SUPERVISOR_USER.email,
        userName: SUPERVISOR_USER.name,
        role: 'REVIEWER',
        grantedAt: '2026-10-02T10:00:00.000Z',
      },
    ],
    connectedRetirementIds: ['ret-demo-002'],
    isDemo: true,
    syncStatus: 'synced',
  };

  return { retirement, dailyRecords, supplementary, logs };
}

export function createConnectedDemoRetirement(): {
  retirement: Retirement;
  dailyRecords: DailyRecord[];
  supplementary: SupplementaryEntry[];
  logs: ActivityLog[];
} {
  const retirementId = 'ret-demo-002';
  const dailyRecords: DailyRecord[] = [
    {
      id: 'rec-conn-01',
      retirementId,
      date: '2026-10-08',
      categories: [
        {
          id: 'cat-conn-c1',
          name: 'Blockwork',
          items: [
            {
              id: 'item-c1',
              description: 'Masons (Blockwork Phase 2)',
              quantity: 8,
              rate: 7000,
              amount: calculateAmount(8, 7000),
            },
            {
              id: 'item-c2',
              description: 'Mortar mixing labourers',
              quantity: 8,
              rate: 4000,
              amount: calculateAmount(8, 4000),
            },
          ],
          subtotal: 88000,
        },
      ],
      dailyTotal: 88000,
      createdAt: '2026-10-08T18:00:00.000Z',
      updatedAt: '2026-10-08T18:00:00.000Z',
      syncStatus: 'synced',
    },
  ];

  const supplementary: SupplementaryEntry[] = [
    {
      id: 'supp-c1',
      retirementId,
      description: 'Scaffolding pipe clamp delivery',
      amount: 45000,
      createdAt: '2026-10-08T19:00:00.000Z',
      syncStatus: 'synced',
    },
  ];

  const logs: ActivityLog[] = [
    {
      id: 'log-c1',
      retirementId,
      userId: DEMO_USER.id,
      userName: DEMO_USER.name,
      action: 'Retirement Created',
      details: 'Created connected retirement RET-9R2B1W',
      timestamp: '2026-10-08T08:00:00.000Z',
    },
  ];

  const retirement: Retirement = {
    id: retirementId,
    code: 'RET-9R2B1W',
    title: 'Block B First Floor Lintels & Column Stubs',
    project: 'Borno State Specialist Hospital Renovation - Phase II',
    ownerId: DEMO_USER.id,
    ownerName: DEMO_USER.name,
    ownerDesignation: DEMO_USER.designation,
    ownerPhone: DEMO_USER.phone,
    createdAt: '2026-10-08T08:00:00.000Z',
    updatedAt: '2026-10-08T18:00:00.000Z',
    status: 'active',
    access: [
      {
        userId: DEMO_USER.id,
        userEmail: DEMO_USER.email,
        userName: DEMO_USER.name,
        role: 'OWNER',
        grantedAt: '2026-10-08T08:00:00.000Z',
      },
    ],
    connectedRetirementIds: ['ret-demo-001'],
    isDemo: true,
    syncStatus: 'synced',
  };

  return { retirement, dailyRecords, supplementary, logs };
}
