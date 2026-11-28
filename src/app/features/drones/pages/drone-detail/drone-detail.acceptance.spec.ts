import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Auth } from '../../../../core/auth/auth';
import { BetaflightSerialService } from '../../../../core/services/betaflight-serial.service';
import { UavInspectionRecord, UavRecord } from '../../../../models/drone-management.models';
import { DroneManagementApi } from '../../data-access/drone-management-api';
import { DroneDetail } from './drone-detail';

const DRONE_ID = '22222222-2222-4222-8222-222222222222';

function makeDrone(overrides: Partial<UavRecord> = {}): UavRecord {
  return {
    id: DRONE_ID,
    code: 'SYN-UAV-01',
    name: 'Synthetic Hexa',
    model: 'SYN-M300',
    category: 'Hexacopter',
    serialNumber: 'SYN-SN-001',
    assignedRegionId: 'syn-reg-1',
    assignedRegionName: 'Khu vực Thử nghiệm',
    operationalStatus: 'Available',
    technicalHealth: 'Unknown',
    flightEnduranceMinutes: 40,
    operationalRangeKm: 15,
    cameraPayloadInfo: null,
    batteryLevel: 92,
    activeFlightController: null,
    createdAt: '2026-11-20T01:00:00Z',
    ...overrides,
  };
}

function makeHistory(): readonly UavInspectionRecord[] {
  return [
    {
      id: 'insp-old',
      droneId: DRONE_ID,
      sourceType: 'manual',
      conclusion: 'Failed',
      status: 'Failed',
      health: 'Critical',
      readiness: 'MaintenanceRequired',
      technicianName: 'KTV Thử nghiệm 1',
      notes: null,
      completedAt: '2026-11-25T02:15:00Z',
      validUntil: null,
      metricCount: 4,
    },
    {
      id: 'insp-new',
      droneId: DRONE_ID,
      sourceType: 'bist',
      conclusion: 'Passed',
      status: 'Passed',
      health: 'Healthy',
      readiness: 'Ready',
      technicianName: 'KTV Thử nghiệm 2',
      notes: 'Cảm biến ổn định',
      completedAt: '2026-11-27T01:30:00Z',
      validUntil: '2026-12-04T01:30:00Z',
      metricCount: 6,
    },
  ];
}

interface SetupOptions {
  readonly user: { id: string; role: string; roles?: readonly string[]; fullName?: string; email?: string; mustChangePassword?: boolean };
  readonly drone?: UavRecord;
  readonly history?: readonly UavInspectionRecord[];
  readonly submitResult?: ReturnType<typeof of> | ReturnType<typeof throwError>;
  readonly historyResult?: ReturnType<typeof of> | ReturnType<typeof throwError>;
}

function setupDroneDetail(options: SetupOptions) {
  const api = {
    getDrone: vi.fn(() => of(options.drone ?? makeDrone())),
    getLatestUavInspection: vi.fn(() => of(null)),
    getTechnicalInspections: vi.fn(() => options.historyResult ?? of(options.history ?? makeHistory())),
    submitUavInspection: vi.fn(
      () =>
        options.submitResult ??
        of<UavInspectionRecord>({
          id: 'insp-created',
          droneId: DRONE_ID,
          sourceType: 'manual',
          conclusion: 'Passed',
          status: 'Passed',
          health: 'Healthy',
          readiness: 'Ready',
          technicianName: 'KTV Thử nghiệm',
          notes: 'Đạt chuẩn sau kiểm tra tay',
          completedAt: '2026-11-27T03:00:00Z',
          validUntil: '2026-12-04T03:00:00Z',
          metricCount: 5,
        }),
    ),
    pairFlightController: vi.fn(() =>
      of({
        id: 'fc-1',
        droneId: DRONE_ID,
        flightControllerUid: 'SYN-FC-99',
        boardIdentifier: 'SYN-F7',
        firmwareName: 'Betaflight',
        firmwareVersion: '4.5.1',
        pairedAt: '2026-11-27T02:00:00Z',
        isActive: true,
      }),
    ),
    unpairFlightController: vi.fn(() => of(undefined)),
  };

  const serialMock = {
    isSupported: true,
    activeMetadata: signal(null),
    connectionState: signal<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected'),
    errorMessage: signal<string | null>(null),
    connectAndRead: vi.fn(() =>
      Promise.resolve({
        uid: 'SYN-FC-99',
        boardIdentifier: 'SYN-F7',
        firmwareName: 'Betaflight',
        firmwareVersion: '4.5.1',
      }),
    ),
    disconnect: vi.fn(() => Promise.resolve()),
  };

  TestBed.configureTestingModule({
    imports: [DroneDetail],
    providers: [
      provideRouter([]),
      { provide: DroneManagementApi, useValue: api },
      { provide: BetaflightSerialService, useValue: serialMock },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: DRONE_ID }) } } },
      {
        provide: Auth,
        useValue: {
          user: signal({
            email: 'syn@test.local',
            fullName: 'Synthetic User',
            mustChangePassword: false,
            ...options.user,
          }),
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(DroneDetail);
  fixture.detectChanges();
  return { fixture, api, serialMock };
}

describe('DroneDetail Acceptance (FE-REQ-101)', () => {
  it('FR-001: allows Technician to save manual BIST, updates readiness label and prepends newest record in UTC+7', () => {
    const { fixture, api } = setupDroneDetail({
      user: { id: 'u-tech', role: 'Technician' },
      drone: makeDrone({ technicalHealth: 'Critical' }),
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Không đạt / Cần bảo trì');

    const notesInput = el.querySelector<HTMLTextAreaElement>('[data-testid="bist-notes-input"]');
    expect(notesInput).not.toBeNull();
    notesInput!.value = 'Đạt chuẩn sau kiểm tra tay';
    notesInput!.dispatchEvent(new Event('input'));

    const submitBtn = el.querySelector<HTMLButtonElement>('[data-testid="bist-submit-btn"]');
    expect(submitBtn).not.toBeNull();
    submitBtn!.click();
    fixture.detectChanges();

    expect(api.submitUavInspection).toHaveBeenCalledTimes(1);
    expect(api.getLatestUavInspection).toHaveBeenCalledWith(DRONE_ID);
    const [calledDroneId, payload] = api.submitUavInspection.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(calledDroneId).toBe(DRONE_ID);
    expect(payload['sourceType']).toBe('manual');
    expect(payload['conclusion']).toBe('Passed');
    expect(payload['notes']).toBe('Đạt chuẩn sau kiểm tra tay');
    expect('preMissionAssessmentId' in payload).toBe(false);

    expect(el.textContent).toContain('Đạt chuẩn / Sẵn sàng');

    // Bản ghi mới nhất (2026-11-27T03:00:00Z = 27/11/2026 10:00 UTC+7) phải nằm đầu danh sách lịch sử
    const rows = Array.from(el.querySelectorAll('[data-testid="inspection-history-row"]'));
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('27/11/2026 10:00');
    expect(rows[1].textContent).toContain('27/11/2026 08:30');
    expect(rows[2].textContent).toContain('25/11/2026 09:15');
  });

  it('FR-002: renders read-only view for Manager and Inspector (hides FC actions and manual BIST form)', () => {
    for (const readOnlyRole of ['Manager', 'Inspector']) {
      TestBed.resetTestingModule();
      const { fixture } = setupDroneDetail({
        user: { id: `u-${readOnlyRole}`, role: readOnlyRole },
        drone: makeDrone({ technicalHealth: 'Healthy' }),
      });

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Đạt chuẩn / Sẵn sàng');
      expect(el.querySelector('[data-testid="bist-manual-form"]')).toBeNull();
      expect(el.querySelector('[data-testid="fc-connect-btn"]')).toBeNull();
      expect(el.querySelectorAll('[data-testid="inspection-history-row"]').length).toBe(2);
    }
  });

  it('HC-02: grants BIST/FC edit access via multi-role union (Manager + Technician)', () => {
    const { fixture } = setupDroneDetail({
      user: { id: 'u-union', role: 'Manager', roles: ['Manager', 'Technician'] },
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="bist-manual-form"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="fc-connect-btn"]')).not.toBeNull();
  });

  it('FR-005 & HC-03: never renders "N/A" for empty optional fields and sorts history DESC in UTC+7', () => {
    const { fixture } = setupDroneDetail({
      user: { id: 'u-admin', role: 'SystemAdmin' },
      drone: makeDrone({ cameraPayloadInfo: null, lastMaintenanceAt: null }),
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('N/A');

    const rows = Array.from(el.querySelectorAll('[data-testid="inspection-history-row"]'));
    expect(rows[0].textContent).toContain('27/11/2026 08:30');
    expect(rows[1].textContent).toContain('25/11/2026 09:15');
  });

  it('FR-006: preserves form input and shows accessible role="alert" on 403/400/409 submit errors without leaking raw payload', () => {
    const { fixture } = setupDroneDetail({
      user: { id: 'u-tech', role: 'Technician' },
      submitResult: throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { errorCode: 'DRONE_ACCESS_DENIED', message: 'DRONE_ACCESS_DENIED: secret-stack-trace' },
          }),
      ),
    });

    const el = fixture.nativeElement as HTMLElement;
    const notesInput = el.querySelector<HTMLTextAreaElement>('[data-testid="bist-notes-input"]')!;
    notesInput.value = 'Ghi chú giữ nguyên khi lỗi';
    notesInput.dispatchEvent(new Event('input'));

    el.querySelector<HTMLButtonElement>('[data-testid="bist-submit-btn"]')!.click();
    fixture.detectChanges();

    const alertEl = el.querySelector('[role="alert"]');
    expect(alertEl).not.toBeNull();
    expect(alertEl!.textContent).not.toContain('secret-stack-trace');
    expect(notesInput.value).toBe('Ghi chú giữ nguyên khi lỗi');
  });
});
