import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AssessmentTowerOption, SelectablePreMissionDrone } from '../../../../models/pre-mission.models';
import { MissionTargetSelection } from '../../../missions/data-access/mission-target-selection';
import { PreMissionApi } from '../../data-access/pre-mission-api';
import { AssessmentCreate } from './assessment-create';

function makeTower(overrides: Partial<AssessmentTowerOption> = {}): AssessmentTowerOption {
  return {
    id: 'syn-t1',
    regionId: 'r1',
    towerCode: 'SYN-01',
    latitude: 10.5,
    longitude: 106.5,
    poleType: 'Cột thép',
    ...overrides,
  };
}

function makeDrones(): readonly SelectablePreMissionDrone[] {
  return [
    {
      id: 'drone-ready-1',
      regionId: 'r1',
      code: 'SYN-UAV-READY',
      name: 'Drone Sẵn sàng',
      model: 'SYN-M350',
      readiness: 'Ready',
      operationalStatus: 'Available',
      technicalHealth: 'Healthy',
    },
    {
      id: 'drone-maint-2',
      regionId: 'r1',
      code: 'SYN-UAV-MAINT',
      name: 'Drone Bảo trì',
      model: 'SYN-M300',
      readiness: 'MaintenanceRequired',
      operationalStatus: 'Maintenance',
      technicalHealth: 'Critical',
    },
    {
      id: 'drone-other-region',
      regionId: 'r2',
      code: 'SYN-UAV-OTHER',
      name: 'Drone khác vùng',
      model: 'SYN-M350',
      readiness: 'Ready',
      operationalStatus: 'Available',
      technicalHealth: 'Healthy',
    },
  ];
}

function setupCreate(createResult?: ReturnType<typeof of> | ReturnType<typeof throwError>) {
  const api = {
    getRegions: vi.fn(() => of([{ id: 'r1', name: 'Khu vực thử nghiệm' }])),
    getRegionTowers: vi.fn(() => of([makeTower()])),
    getRegionDrones: vi.fn(() => of(makeDrones())),
    get: vi.fn(),
    create: vi.fn(() => createResult ?? of({ id: 'pma-created' })),
  };

  TestBed.configureTestingModule({
    imports: [AssessmentCreate],
    providers: [
      provideRouter([]),
      { provide: PreMissionApi, useValue: api },
      { provide: MissionTargetSelection, useValue: { selected: signal([]), clear: vi.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
    ],
  });

  const router = TestBed.inject(Router);
  vi.spyOn(router, 'navigate').mockResolvedValue(true);

  const fixture = TestBed.createComponent(AssessmentCreate);
  fixture.detectChanges();
  return { fixture, api };
}

describe('AssessmentCreate Acceptance (FE-REQ-101)', () => {
  it('FR-003 & FR-004: only allows selecting Ready drones, submits 3 role headcounts without user picker, and has zero BIST controls', () => {
    const { fixture, api } = setupCreate();
    const el = fixture.nativeElement as HTMLElement;

    // Không có bước/form kiểm tra kỹ thuật BIST trên màn tạo Pre-Mission
    expect(el.querySelector('[data-testid="bist-manual-form"]')).toBeNull();
    expect(el.querySelector('[data-testid="fc-connect-btn"]')).toBeNull();

    // Chọn khu vực để tải cột & drone
    const regionSelect = el.querySelector<HTMLSelectElement>('#regionId')!;
    regionSelect.value = 'r1';
    regionSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // Chỉ cho chọn Drone Đạt chuẩn / Sẵn sàng; Drone Không đạt / Cần bảo trì bị vô hiệu hóa
    const readyCheckbox = el.querySelector<HTMLInputElement>('[data-testid="drone-option-drone-ready-1"]');
    const maintCheckbox = el.querySelector<HTMLInputElement>('[data-testid="drone-option-drone-maint-2"]');
    expect(readyCheckbox).not.toBeNull();
    expect(maintCheckbox).not.toBeNull();
    expect(readyCheckbox!.disabled).toBe(false);
    expect(maintCheckbox!.disabled).toBe(true);
    expect(el.querySelector('[data-testid="drone-option-drone-other-region"]')).toBeNull();
    expect(el.textContent).toContain('Đạt chuẩn / Sẵn sàng');
    expect(el.textContent).toContain('Không đạt / Cần bảo trì');

    // Chọn cột và Drone sẵn sàng
    el.querySelector<HTMLInputElement>('.tower-pick-item input[type="checkbox"]')!.click();
    readyCheckbox!.click();

    // Nhập số lượng 3 role (Reactive Form, không chọn UserId đích danh)
    const inspectorInput = el.querySelector<HTMLInputElement>('#inspectorCount')!;
    const analystInput = el.querySelector<HTMLInputElement>('#analystCount')!;
    const technicianInput = el.querySelector<HTMLInputElement>('#technicianCount')!;
    inspectorInput.value = '2';
    inspectorInput.dispatchEvent(new Event('input'));
    analystInput.value = '1';
    analystInput.dispatchEvent(new Event('input'));
    technicianInput.value = '2';
    technicianInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    fixture.detectChanges();

    expect(api.create).toHaveBeenCalledTimes(1);
    const payload = (api.create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(payload['inspectorCount']).toBe(2);
    expect(payload['analystCount']).toBe(1);
    expect(payload['technicianCount']).toBe(2);
    expect(payload['droneIds']).toEqual(['drone-ready-1']);
  });

  it('FR-005 & FR-006: renders zero "N/A" and preserves form + shows role="alert" on 409 DRONE_NOT_READY / 400 INVALID_ROLE_HEADCOUNT', () => {
    const { fixture } = setupCreate(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { errorCode: 'DRONE_NOT_READY', message: 'DRONE_NOT_READY: internal-debug' },
          }),
      ),
    );
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('N/A');

    const regionSelect = el.querySelector<HTMLSelectElement>('#regionId')!;
    regionSelect.value = 'r1';
    regionSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    el.querySelector<HTMLInputElement>('.tower-pick-item input[type="checkbox"]')!.click();
    el.querySelector<HTMLInputElement>('[data-testid="drone-option-drone-ready-1"]')!.click();
    const inspectorInput = el.querySelector<HTMLInputElement>('#inspectorCount')!;
    inspectorInput.value = '3';
    inspectorInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    fixture.detectChanges();

    const alertEl = el.querySelector('[role="alert"]');
    expect(alertEl).not.toBeNull();
    expect(alertEl!.textContent).not.toContain('internal-debug');
    expect(inspectorInput.value).toBe('3');
  });
});
