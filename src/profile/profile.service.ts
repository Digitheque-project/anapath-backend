import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from './user-profile.entity';

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(UserProfile)
    private readonly repo: Repository<UserProfile>,
  ) {}

  /** Renvoie le profil (une entité non persistée si aucun n'existe encore). */
  async get(userId: string): Promise<UserProfile> {
    const existing = await this.repo.findOne({ where: { userId } });
    return (
      existing ??
      this.repo.create({
        userId,
        bio: null,
        avatarFilename: null,
      })
    );
  }

  async updateBio(userId: string, bio: string): Promise<UserProfile> {
    const p = await this.get(userId);
    p.bio = bio;
    return this.repo.save(p);
  }

  async setAvatar(userId: string, avatarFilename: string): Promise<UserProfile> {
    const p = await this.get(userId);
    p.avatarFilename = avatarFilename;
    return this.repo.save(p);
  }
}
