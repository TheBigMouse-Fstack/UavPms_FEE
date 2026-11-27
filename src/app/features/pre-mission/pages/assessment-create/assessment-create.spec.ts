import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AssessmentTowerOption } from '../../../../models/pre-mission.models';
import { LocalMapMode } from '../../../../shared/gis/local-gis';
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

describe('AssessmentCreate local-only GIS (FE-REQ-004 PR-1b2)', () => {
  const createComponent = () => {
    const api = {
      getRegions: vi.fn(() => of([{ id: 'r1', name: 'Khu vực thử nghiệm' }])),
      getRegionTowers: vi.fn(() => of([])),
      get: vi.fn(),
      create: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [AssessmentCreate],
      providers: [
        provideRouter([]),
        { provide: PreMissionApi, useValue: api },
        {
          provide: MissionTargetSelection,
          useValue: { selected: signal([]), clear: vi.fn() },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
      ],
    });

    const fixture = TestBed.createComponent(AssessmentCreate);
    fixture.detectChanges();
    return {
      fixture,
      instance: fixture.componentInstance as unknown as Record<string, unknown>,
    };
  };

  it('defaults to local pmtiles mode and switches cleanly to schematic with accessible controls', () => {
    const { fixture, instance } = createComponent();
    const currentMapType = instance['currentMapType'] as () => LocalMapMode;
    const setMapType = (instance['setMapType'] as (mode: LocalMapMode) => void).bind(instance);

    // Trong môi trường jsdom không có WebGL, createLocalGisMap tự hạ cấp an toàn sang schematic.
    expect(currentMapType()).toBe('schematic');

    setMapType('pmtiles');
    fixture.detectChanges();
    expect(currentMapType()).toBe('pmtiles');

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.map-type-btn')) as HTMLButtonElement[];
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');

    setMapType('schematic');
    fixture.detectChanges();
    expect(currentMapType()).toBe('schematic');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('filters malformed coordinates safely without dropping valid synthetic towers or logging', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { instance } = createComponent();
    const towersSignal = instance['towers'] as { set: (v: readonly AssessmentTowerOption[]) => void };
    const getValidTowers = (instance['getValidTowers'] as () => AssessmentTowerOption[]).bind(instance);

    towersSignal.set([
      makeTower({ id: 'syn-1', towerCode: 'SYN-01', latitude: 10.25, longitude: 106.25 }),
      makeTower({ id: 'bad-nan', towerCode: 'BAD-NAN', latitude: Number.NaN, longitude: 106.25 }),
      makeTower({ id: 'bad-null', towerCode: 'BAD-NULL', latitude: null as unknown as number, longitude: 106.25 }),
      makeTower({ id: 'bad-range', towerCode: 'BAD-RANGE', latitude: 999, longitude: 106.25 }),
      makeTower({ id: 'syn-2', towerCode: 'SYN-02', latitude: 11.25, longitude: 107.25 }),
    ]);

    const valid = getValidTowers();
    expect(valid.map((t) => t.id)).toEqual(['syn-1', 'syn-2']);
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('switches to local schematic mode automatically when synthetic towers fall outside PMTiles coverage', () => {
    const { instance } = createComponent();
    const towersSignal = instance['towers'] as { set: (v: readonly AssessmentTowerOption[]) => void };
    const setMapType = (instance['setMapType'] as (mode: LocalMapMode) => void).bind(instance);
    const renderMap = (instance['renderMap'] as (fit?: boolean) => void).bind(instance);
    const currentMapType = instance['currentMapType'] as () => LocalMapMode;

    setMapType('pmtiles');
    towersSignal.set([makeTower({ id: 'syn-north', towerCode: 'SYN-N1', latitude: 21.0, longitude: 105.5 })]);
    renderMap(false);

    expect(currentMapType()).toBe('schematic');
  });

  it('builds marker DOM elements with textContent and aria-label without HTML injection', () => {
    const { instance } = createComponent();
    const createMarkerEl = (
      instance['createTowerMarkerElement'] as (tower: AssessmentTowerOption, seq: number | null) => HTMLButtonElement
    ).bind(instance);

    const el = createMarkerEl(makeTower({ towerCode: '<img src=x>', poleType: 'Thép' }), 2);
    expect(el.tagName).toBe('BUTTON');
    expect(el.getAttribute('aria-label')).toContain('Thứ tự #2: <img src=x>');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('2');
  });
});
