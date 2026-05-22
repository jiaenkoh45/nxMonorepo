import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Creator } from './creator';

describe('Creator', () => {
  let component: Creator;
  let fixture: ComponentFixture<Creator>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Creator],
    }).compileComponents();

    fixture = TestBed.createComponent(Creator);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
