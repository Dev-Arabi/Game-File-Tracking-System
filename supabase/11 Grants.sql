grant select on
  public.profiles,
  public.games,
  public.player_hours,
  public.file_updates
to authenticated;

grant insert on
  public.games,
  public.player_hours,
  public.file_updates
to authenticated;

grant update on
  public.profiles
to authenticated;