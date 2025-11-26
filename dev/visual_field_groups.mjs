export const VISUAL_FIELD_GROUPS = [
  {
    id: 'headlight',
    label: 'Headlight',
    fields: [
      ['headlight', 'active'],
      ['headlight', 'ambient'],
      ['headlight', 'diffuse'],
      ['headlight', 'specular'],
    ],
    consumers: ['lighting'],
  },
  {
    id: 'fog',
    label: 'Fog',
    fields: [
      ['map', 'fogstart'],
      ['map', 'fogend'],
      ['rgba', 'fog'],
    ],
    sceneFlagIndex: 5,
    consumers: ['fog'],
  },
  {
    id: 'haze',
    label: 'Haze',
    fields: [
      ['map', 'haze'],
      ['rgba', 'haze'],
    ],
    sceneFlagIndex: 6,
    consumers: ['haze'],
  },
  {
    id: 'contact_points',
    label: 'Contact Points',
    fields: [
      ['scale', 'contactwidth'],
      ['scale', 'contactheight'],
      ['rgba', 'contact'],
    ],
    voptFlagIndex: 14,
    consumers: ['contact_points'],
  },
  {
    id: 'contact_forces',
    label: 'Contact Forces',
    fields: [
      ['map', 'force'],
      ['scale', 'forcewidth'],
      ['rgba', 'contactforce'],
    ],
    voptFlagIndex: 16,
    consumers: ['contact_forces'],
  },
  {
    id: 'select_point',
    label: 'Select Point',
    fields: [
      ['scale', 'selectpoint'],
      ['rgba', 'selectpoint'],
    ],
    consumers: ['selection'],
  },
];

export function listVisualGroupIds() {
  return VISUAL_FIELD_GROUPS.map((group) => group.id);
}
